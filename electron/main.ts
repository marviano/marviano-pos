import { app, BrowserWindow, Menu, ipcMain, screen, protocol } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { PrinterManagementService } from './printerManagement';
import { initializeMySQLPool, getMySQLPool, executeQuery, executeQueryOne, executeUpdate, executeUpsert, executeTransaction, getConnection, initializeSystemPosPool, executeSystemPosQuery, executeSystemPosQueryOne, executeSystemPosUpdate, executeSystemPosTransaction, executeSystemPosDdl, executeSystemPosDdlIgnoreDup, executeDdlIgnoreDup, toMySQLDateTime, toMySQLTimestamp, testDatabaseConnection, insertTransactionToSystemPos, upsertProductsFromMainToSystemPos, syncRefundedTransactionsToSystemPos } from './mysqlDb';
import { initializeMySQLSchema } from './mysqlSchema';
import { readConfig, writeConfig, resetConfig, getDbConfig, type AppConfig } from './configManager';
import { ReceiptManagementService, ReceiptTemplateData } from './receiptManagement';

// Store original console functions early (before they might be suppressed)
// These are used to bypass console suppression for critical error messages
const originalConsoleLog = console.log.bind(console);
const originalConsoleError = console.error.bind(console);
const originalConsoleInfo = console.info.bind(console);
const originalConsoleDebug = console.debug.bind(console);

// Debug log disabled to prevent unbounded file growth (was writing to .cursor/debug.log).
// Re-enable temporarily by uncommenting the body and using a bounded/rotating log if needed.
function writeDebugLog(_data: string): void {
  // no-op
}

/** Append one NDJSON line to workspace debug-76ac0a.log for label-print debugging (session 76ac0a). */
function writeLabelDebugLog(payload: Record<string, unknown>): void {
  try {
    const logPath = path.join(__dirname, '..', 'debug-76ac0a.log');
    const line = JSON.stringify({ sessionId: '76ac0a', ...payload, timestamp: payload.timestamp ?? Date.now() }) + '\n';
    fs.appendFileSync(logPath, line);
  } catch {
    // do not break app if log write fails
  }
}

/** Extract @page rule snippet from HTML for debug (label height). */
function getAtPageSnippet(html: string): string | null {
  const m = html.match(/@page\s*\{[^}]*\}/);
  return m ? m[0].replace(/\s+/g, ' ').trim() : null;
}

/** Write system_pos save failure to .cursor/system_pos_debug.log for debugging intermittent sync failures. */
function writeSystemPosDebugLog(entry: { source: string; transactionId: string; reason: string; stack?: string }): void {
  try {
    const logPath = path.join(__dirname, '..', '.cursor', 'system_pos_debug.log');
    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ...entry
    }) + '\n';
    fs.appendFileSync(logPath, line);
  } catch {
    // do not break app if log write fails
  }
}


// MySQL pool will be initialized in createWindow

// MySQL database will be initialized in createWindow function

// Allow audio autoplay without user gesture (for barista/kitchen new-order sound on dedicated displays)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Register custom protocol before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'slideshow-file',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      corsEnabled: true,
      standard: true
    }
  },
  {
    scheme: 'pos-image',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      corsEnabled: true,
      standard: true
    }
  }
]);

type UnknownRecord = Record<string, unknown>;

type TableInfoRow = {
  name: string | null;
};

type RowArray = UnknownRecord[];

type BundleItemRow = {
  id: number;
  bundle_product_id: number;
  category2_id: number;
  required_quantity: number;
  display_order: number;
  category2_name: string | null;
};

type CustomizationTypeRow = {
  id: number;
  name: string;
  selection_mode: 'single' | 'multiple';
};

type CustomizationOptionRow = {
  id: number;
  type_id: number;
  name: string;
  price_adjustment: number;
  display_order?: number | null;
};

type ShiftRow = {
  id: number;
  user_id: number;
  user_name: string;
  shift_start: string;
};

type QueryParam = string | number | null;
type QueryParams = QueryParam[];

type PrinterConfigRow = {
  printer_type: string;
  system_printer_name?: string | null;
  extra_settings?: string | UnknownRecord | null;
};

type ReceiptLineItem = {
  name: string;
  quantity: number;
  price: number;
  total_price: number;
  product?: { nama?: string };
  unit_price?: number;
  custom_note?: string;
  customizations?: string | RawCustomization[] | { customization_name?: string; option_name?: string; name?: string }[];
};

type ReceiptPrintData = {
  printerType?: string;
  printerName?: string;
  marginAdjustMm?: number;
  business_id?: number;
  items: ReceiptLineItem[];
  total: number;
  paymentMethod?: string;
  amountReceived?: number;
  change?: number;
  date?: string;
  receiptNumber?: string | number;
  tableNumber?: string;
  cashier?: string;
  customerName?: string;
  customer_name?: string;
  transactionType?: string;
  pickupMethod?: string;
  printer1Counter?: number;
  printer2Counter?: number;
  globalCounter?: number;
  type?: 'test' | 'normal';
  final_amount?: number;
  isReprint?: boolean;
  reprintCount?: number;
  id?: string | number;
  isBill?: boolean;
  voucherDiscount?: number;
  voucherLabel?: string;
};

type LabelPrintData = {
  printerType?: string;
  printerName?: string;
  productName?: string;
  customizations?: string;
  customNote?: string;
  orderTime?: string;
  counter?: number;
  itemNumber?: number;
  totalItems?: number;
  pickupMethod?: string;
  labelContinuation?: string;
  /** Optional business_id to load checker template (template struk → Template Checker). */
  business_id?: number;
  /** Order-summary slip: waiter/customer/table/items (used when template has {{waiterName}}, {{items}}, etc.) */
  waiterName?: string;
  customerName?: string;
  tableName?: string;
  /** Pre-rendered HTML for items table rows (e.g. <tr><td>...</td></tr> per item). */
  items?: string;
  /** Pre-rendered HTML for category1 items (order-summary slip with 2 sections). */
  itemsCategory1?: string;
  /** Pre-rendered HTML for category2 items (order-summary slip with 2 sections). */
  itemsCategory2?: string;
  /** Section header for category 1 (e.g. Makanan). */
  category1Name?: string;
  /** Section header for category 2 (e.g. Minuman). */
  category2Name?: string;
  /** All Category 1 sections for checker (when template uses {{categoriesSections}}). */
  categories?: Array<{ categoryName: string; itemsHtml: string }>;
  /** Padding for 80mm checker template (same as receipt). Replaces {{leftPadding}}/{{rightPadding}} in template. */
  leftPadding?: string;
  rightPadding?: string;
  /** Margin adjust from Printer 3 setup (used to compute leftPadding/rightPadding when not provided). */
  marginAdjustMm?: number;
};

/** Resolve a preferred printer name to a valid system deviceName. Returns undefined to use default printer if name is missing or not in system list (avoids "Invalid deviceName provided"). */
async function resolvePrintDeviceName(webContents: Electron.WebContents, preferredName: string | null | undefined): Promise<string | undefined> {
  const name = typeof preferredName === 'string' ? preferredName.trim() : '';
  if (!name) return undefined;
  try {
    const printers = await webContents.getPrintersAsync();
    const names = printers.map(p => p?.name).filter(Boolean) as string[];
    if (names.includes(name)) return name;
    console.warn('🖨️ Printer name not in system list, using default printer:', name);
  } catch (e) {
    console.warn('🖨️ Could not get printer list, using default:', e);
  }
  return undefined;
}

type RawCustomizationOption = {
  option_id?: number;
  option_name?: string;
  price_adjustment?: number;
};

type RawCustomization = {
  customization_id?: number;
  customization_name?: string;
  selected_options?: RawCustomizationOption[];
};

type RawBundleSelectionProduct = {
  quantity?: number;
  product?: {
    id?: number;
    nama?: string;
  };
  customizations?: RawCustomization[];
};

type RawBundleSelection = {
  selectedProducts?: RawBundleSelectionProduct[];
};

const parseJsonArray = <T>(
  value: string | UnknownRecord | UnknownRecord[] | null | undefined,
  context?: string
): T[] => {
  if (!value) {
    return [];
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch (error) {
      console.warn(`⚠️ Failed to parse JSON array${context ? ` for ${context}` : ''}:`, error);
      return [];
    }
  }

  if (Array.isArray(value)) {
    return value as T[];
  }

  return [];
};

/**
 * Reads customizations from normalized tables (NO JSON)
 * bundleProductId: NULL/undefined = main product, number = specific bundle product
 */
const readCustomizationsFromNormalizedTables = async (
  transactionItemUuid: string,
  bundleProductId?: number | null
): Promise<RawCustomization[] | null> => {
  try {
    // Look up the INT id from transaction_items using UUID
    const itemRow = await executeQueryOne<{ id: number }>(
      'SELECT id FROM transaction_items WHERE uuid_id = ? LIMIT 1',
      [transactionItemUuid]
    );

    if (!itemRow || typeof itemRow.id !== 'number') {
      return null;
    }

    const transactionItemId = itemRow.id;

    // Read from normalized tables - filter by bundle_product_id
    const customizations = await executeQuery<{
      customization_id: number;
      customization_name: string;
      option_id: number | null;
      option_name: string | null;
      price_adjustment: number | null;
      bundle_product_id: number | null;
    }>(`
      SELECT 
        tic.customization_type_id as customization_id,
        pct.name as customization_name,
        tico.customization_option_id as option_id,
        tico.option_name,
        tico.price_adjustment,
        tic.bundle_product_id
      FROM transaction_item_customizations tic
      JOIN product_customization_types pct ON tic.customization_type_id = pct.id
      LEFT JOIN transaction_item_customization_options tico ON tic.id = tico.transaction_item_customization_id
      WHERE tic.transaction_item_id = ?
        AND (tic.bundle_product_id IS NULL AND ? IS NULL OR tic.bundle_product_id = ?)
      ORDER BY tic.id, tico.id
    `, [transactionItemId, bundleProductId || null, bundleProductId || null]);

    if (customizations.length === 0) {
      return null;
    }

    // Group by customization type
    const grouped = new Map<number, RawCustomization>();
    for (const row of customizations) {
      if (!grouped.has(row.customization_id)) {
        grouped.set(row.customization_id, {
          customization_id: row.customization_id,
          customization_name: row.customization_name,
          selected_options: []
        });
      }

      const customization = grouped.get(row.customization_id)!;
      if (row.option_id && row.option_name !== null) {
        customization.selected_options = customization.selected_options || [];
        customization.selected_options.push({
          option_id: row.option_id,
          option_name: row.option_name,
          price_adjustment: row.price_adjustment || 0
        });
      }
    }

    return Array.from(grouped.values());
  } catch (error) {
    console.warn('⚠️ Error reading from normalized tables:', error);
    return null;
  }
};

/**
 * Saves customizations to normalized tables for analytics
 * NO JSON - only normalized tables
 */
const saveCustomizationsToNormalizedTables = async (
  transactionItemUuid: string,
  customizations: RawCustomization[] | null | undefined,
  createdAt: string,
  bundleProductId?: number | null  // NULL or undefined = main product, number = bundle product ID
): Promise<void> => {
  if (!customizations || !Array.isArray(customizations) || customizations.length === 0) {
    return;
  }

  try {
    // Look up the INT id from transaction_items using UUID
    const itemRow = await executeQueryOne<{ id: number }>(
      'SELECT id FROM transaction_items WHERE uuid_id = ? LIMIT 1',
      [transactionItemUuid]
    );

    if (!itemRow || typeof itemRow.id !== 'number') {
      console.warn(`⚠️ Transaction item UUID ${transactionItemUuid} not found, skipping customizations save`);
      return;
    }

    const transactionItemId = itemRow.id;

    // Convert createdAt to MySQL format (YYYY-MM-DD HH:MM:SS)
    // Handle ISO strings, Date objects, or already-formatted strings
    let mysqlCreatedAt: string;
    if (typeof createdAt === 'string') {
      // If it's an ISO string (contains 'T' or 'Z'), convert it
      if (createdAt.includes('T') || createdAt.includes('Z')) {
        const converted = toMySQLTimestamp(createdAt);
        mysqlCreatedAt = converted || toMySQLTimestamp(new Date()) || '';
      } else {
        // Already in MySQL format
        mysqlCreatedAt = createdAt;
      }
    } else {
      // Fallback: convert to MySQL format
      const converted = toMySQLTimestamp(createdAt || new Date());
      mysqlCreatedAt = converted || toMySQLTimestamp(new Date()) || '';
    }

    if (!mysqlCreatedAt) {
      console.warn('⚠️ Failed to convert createdAt to MySQL format, using current timestamp');
      mysqlCreatedAt = toMySQLTimestamp(new Date()) || new Date().toISOString().replace('T', ' ').slice(0, 19);
    }

    const connection = await getConnection();
    try {
      await connection.beginTransaction();

      // Delete existing normalized data for this transaction item and bundle product (in case of update)
      await connection.query(`
        DELETE FROM transaction_item_customization_options 
        WHERE transaction_item_customization_id IN (
          SELECT id FROM transaction_item_customizations 
          WHERE transaction_item_id = ? 
            AND (bundle_product_id IS NULL AND ? IS NULL OR bundle_product_id = ?)
        )
      `, [transactionItemId, bundleProductId || null, bundleProductId || null]);

      await connection.query(`
        DELETE FROM transaction_item_customizations 
        WHERE transaction_item_id = ? 
          AND (bundle_product_id IS NULL AND ? IS NULL OR bundle_product_id = ?)
      `, [transactionItemId, bundleProductId || null, bundleProductId || null]);

      // Insert into normalized tables
      for (const customization of customizations) {
        const customizationId = Number(customization.customization_id);
        if (!customizationId || Number.isNaN(customizationId)) {
          console.warn('⚠️ Invalid customization_id:', customization.customization_id);
          continue;
        }

        // Insert customization type link (use INT id and UUID)
        const [ticResult] = await connection.query(`
          INSERT INTO transaction_item_customizations (transaction_item_id, uuid_transaction_item_id, customization_type_id, bundle_product_id, created_at)
          VALUES (?, ?, ?, ?, ?)
        `, [transactionItemId, transactionItemUuid, customizationId, bundleProductId || null, mysqlCreatedAt]) as any;
        const ticId = ticResult.insertId;

        // Insert selected options
        if (Array.isArray(customization.selected_options)) {
          for (const option of customization.selected_options) {
            const optionId = Number(option.option_id);
            if (!optionId || Number.isNaN(optionId)) {
              console.warn('⚠️ Invalid option_id:', option.option_id);
              continue;
            }

            const optionName = option.option_name || 'Unknown Option';
            const priceAdjustment = Number(option.price_adjustment) || 0;

            await connection.query(`
              INSERT INTO transaction_item_customization_options (
                transaction_item_customization_id, customization_option_id, option_name, price_adjustment, created_at
              ) VALUES (?, ?, ?, ?, ?)
            `, [ticId, optionId, optionName, priceAdjustment, mysqlCreatedAt]);
          }
        }
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('❌ Error saving customizations to normalized tables:', error);
    // Don't throw - we want to continue even if normalized save fails
    // The JSON format is still saved, so data is not lost
  }
};

type TransactionItemRow = {
  product_id: number;
  product_name: string;
  product_code: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  id?: string;  // transaction_item id for reading from normalized tables
  bundle_selections_json?: string | UnknownRecord | UnknownRecord[];
  transaction_type: string;
  payment_method_code?: string;
  payment_method?: string;
  harga_jual?: number;
  harga_gofood?: number;
  harga_grabfood?: number;
  harga_shopeefood?: number;
  harga_qpon?: number;
  harga_tiktok?: number;
  refund_total?: number;
  final_amount?: number | null;
  total_amount?: number | null;
  tx_items_total?: number;
};

type TransactionRefundRow = {
  id?: number;
  uuid_id: string;
  transaction_uuid: string;
  business_id: number;
  shift_uuid?: string | null;
  refunded_by: number;
  refund_amount: number;
  cash_delta: number;
  payment_method_id: number;
  reason?: string | null;
  note?: string | null;
  refund_type?: string | null;
  status?: string | null;
  refunded_at: string;
  created_at?: string | null;
  updated_at?: number | null;
  synced_at?: number | null;
};

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const shouldLog = process.env.POS_DEBUG_LOGS === 'true';

// if (!shouldLog) {
//   console.log = () => { };
//   console.info = () => { };
//   console.debug = () => { };
// }

// Global references to windows and services
let mainWindow: BrowserWindow | null = null;
let customerWindow: BrowserWindow | null = null;
let printWindow: BrowserWindow | null = null;
let baristaKitchenWindow: BrowserWindow | null = null;
let kitchenDisplayWindow: BrowserWindow | null = null;
let baristaDisplayWindow: BrowserWindow | null = null;
// MySQL pool is managed by mysqlDb module
let printerService: PrinterManagementService | null = null;

// Print queue system to prevent label printing interruption
interface PrintJob {
  type: 'label' | 'labels-batch';
  data: any;
  resolve: (result: { success: boolean; error?: string }) => void;
  reject: (error: Error) => void;
}

let printQueue: PrintJob[] = [];
let isProcessingQueue = false;

async function processPrintQueue(): Promise<void> {
  if (isProcessingQueue || printQueue.length === 0) {
    return;
  }

  isProcessingQueue = true;
  console.log(`📋 [PRINT QUEUE] Processing queue, ${printQueue.length} job(s) pending`);

  while (printQueue.length > 0) {
    const job = printQueue.shift();
    if (!job) break;

    try {
      console.log(`🖨️ [PRINT QUEUE] Processing ${job.type} job`);
      let result: { success: boolean; error?: string };

      if (job.type === 'label') {
        result = await executeLabelPrint(job.data);
      } else {
        result = await executeLabelsBatchPrint(job.data);
      }

      job.resolve(result);
      console.log(`✅ [PRINT QUEUE] ${job.type} job completed`);
    } catch (error) {
      console.error(`❌ [PRINT QUEUE] ${job.type} job failed:`, error);
      job.reject(error instanceof Error ? error : new Error(String(error)));
    }

    // Small delay between jobs to ensure printer is ready
    if (printQueue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  isProcessingQueue = false;
  console.log(`✅ [PRINT QUEUE] Queue processing complete`);
}

let windowsInitialized = false;
let ipcHandlersRegistered = false;

/** Lazy migration: ensure transaction_items.waiter_id exists on main DB (retry until success). */
let transactionItemsWaiterIdEnsured = false;
async function ensureTransactionItemsWaiterIdColumn(): Promise<void> {
  if (transactionItemsWaiterIdEnsured) return;
  try {
    await executeDdlIgnoreDup('ALTER TABLE transaction_items ADD COLUMN waiter_id INT DEFAULT NULL COMMENT \'Employee who added this line item\' AFTER created_at');
    await executeDdlIgnoreDup('ALTER TABLE transaction_items ADD INDEX idx_transaction_items_waiter (waiter_id)');
    transactionItemsWaiterIdEnsured = true;
    console.log('✅ transaction_items.waiter_id column ensured (lazy migration)');
  } catch (e) {
    console.warn('⚠️ Lazy migration transaction_items.waiter_id failed (will retry on next use):', (e as Error)?.message);
  }
}

/** Lazy migration: ensure transaction_items.package_line_finished_at_json exists (legacy; prefer transaction_item_package_lines.finished_at). */
let transactionItemsPackageLineFinishedAtEnsured = false;
async function ensureTransactionItemsPackageLineFinishedAtColumn(): Promise<void> {
  if (transactionItemsPackageLineFinishedAtEnsured) return;
  try {
    await executeDdlIgnoreDup('ALTER TABLE transaction_items ADD COLUMN package_line_finished_at_json TEXT DEFAULT NULL COMMENT \'Per-line finished-at times for package breakdown (JSON: {"0":"iso",...})\' AFTER production_finished_at');
    transactionItemsPackageLineFinishedAtEnsured = true;
    console.log('✅ transaction_items.package_line_finished_at_json column ensured (lazy migration)');
  } catch (e) {
    console.warn('⚠️ Lazy migration transaction_items.package_line_finished_at_json failed (will retry on next use):', (e as Error)?.message);
  }
}

/** Lazy migration: ensure transaction_item_package_lines.finished_at exists (normalized per-line completion). */
let transactionItemPackageLinesFinishedAtEnsured = false;
async function ensureTransactionItemPackageLinesFinishedAtColumn(): Promise<void> {
  if (transactionItemPackageLinesFinishedAtEnsured) return;
  try {
    await executeDdlIgnoreDup('ALTER TABLE transaction_item_package_lines ADD COLUMN finished_at TIMESTAMP NULL DEFAULT NULL AFTER quantity');
    await executeDdlIgnoreDup('ALTER TABLE transaction_item_package_lines ADD INDEX idx_tipl_finished_at (finished_at)');
    transactionItemPackageLinesFinishedAtEnsured = true;
    console.log('✅ transaction_item_package_lines.finished_at column ensured (lazy migration)');
  } catch (e) {
    console.warn('⚠️ Lazy migration transaction_item_package_lines.finished_at failed (will retry on next use):', (e as Error)?.message);
  }
}

/** Lazy migration: ensure transaction_item_package_lines.note exists (per-item customization notes). */
let transactionItemPackageLinesNoteEnsured = false;
async function ensureTransactionItemPackageLinesNoteColumn(): Promise<void> {
  if (transactionItemPackageLinesNoteEnsured) return;
  try {
    await executeDdlIgnoreDup('ALTER TABLE transaction_item_package_lines ADD COLUMN note VARCHAR(120) NULL DEFAULT NULL AFTER quantity');
    transactionItemPackageLinesNoteEnsured = true;
    console.log('✅ transaction_item_package_lines.note column ensured (lazy migration)');
  } catch (e) {
    console.warn('⚠️ Lazy migration transaction_item_package_lines.note failed (will retry on next use):', (e as Error)?.message);
  }
}

/** Lazy migration: ensure transaction_items cancellation audit columns exist. */
let transactionItemsCancellationColumnsEnsured = false;
async function ensureTransactionItemsCancellationColumns(): Promise<void> {
  if (transactionItemsCancellationColumnsEnsured) return;
  try {
    await executeDdlIgnoreDup('ALTER TABLE transaction_items ADD COLUMN cancelled_by_user_id INT DEFAULT NULL COMMENT \'User who authorized the cancellation\' AFTER production_finished_at');
    await executeDdlIgnoreDup('ALTER TABLE transaction_items ADD COLUMN cancelled_by_waiter_id INT DEFAULT NULL COMMENT \'Waiter who performed the cancellation via PIN\' AFTER cancelled_by_user_id');
    await executeDdlIgnoreDup('ALTER TABLE transaction_items ADD COLUMN cancelled_at TIMESTAMP NULL DEFAULT NULL COMMENT \'When this item was cancelled\' AFTER cancelled_by_waiter_id');
    await executeDdlIgnoreDup('ALTER TABLE transaction_items ADD INDEX idx_transaction_items_cancelled_by_user (cancelled_by_user_id)');
    await executeDdlIgnoreDup('ALTER TABLE transaction_items ADD INDEX idx_transaction_items_cancelled_by_waiter (cancelled_by_waiter_id)');
    await executeDdlIgnoreDup('ALTER TABLE transaction_items ADD INDEX idx_transaction_items_cancelled_at (cancelled_at)');
    transactionItemsCancellationColumnsEnsured = true;
    console.log('✅ transaction_items cancellation audit columns ensured (lazy migration)');
  } catch (e) {
    console.warn('⚠️ Lazy migration transaction_items cancellation columns failed (will retry on next use):', (e as Error)?.message);
  }
}

async function ensureSystemPosQueueTable(): Promise<void> {
  const sql = `CREATE TABLE IF NOT EXISTS system_pos_queue (
    id INT NOT NULL AUTO_INCREMENT,
    transaction_id VARCHAR(255) NOT NULL,
    queued_at BIGINT NOT NULL,
    synced_at BIGINT NULL,
    retry_count INT NOT NULL DEFAULT 0,
    last_error VARCHAR(500) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_transaction_id (transaction_id),
    KEY idx_synced_at (synced_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
  await executeSystemPosDdl(sql);
}

async function ensureSystemPosSchema(): Promise<void> {
  console.log('[SYSTEM POS] Ensuring schema (transactions, transaction_items, ...)...');
  const mainDb = getDbConfig().database || 'salespulse';

  const tables: string[] = [
    `CREATE TABLE IF NOT EXISTS transactions (
      id INT NOT NULL AUTO_INCREMENT,
      uuid_id VARCHAR(255) NOT NULL,
      business_id INT NOT NULL,
      user_id INT DEFAULT NULL,
      waiter_id INT DEFAULT NULL,
      shift_uuid VARCHAR(255) DEFAULT NULL,
      payment_method VARCHAR(50) DEFAULT NULL,
      payment_method_id INT NOT NULL DEFAULT 1,
      sync_status ENUM('pending','synced','failed') DEFAULT 'pending',
      sync_attempts INT DEFAULT 0,
      synced_at DATETIME DEFAULT NULL,
      last_sync_attempt TIMESTAMP NULL DEFAULT NULL,
      table_id INT DEFAULT NULL,
      pickup_method VARCHAR(50) DEFAULT NULL,
      total_amount DECIMAL(15,2) DEFAULT NULL,
      voucher_discount DECIMAL(15,2) DEFAULT 0.00,
      voucher_type VARCHAR(50) DEFAULT NULL,
      voucher_value DECIMAL(15,2) DEFAULT NULL,
      voucher_label VARCHAR(255) DEFAULT NULL,
      final_amount DECIMAL(15,2) DEFAULT NULL,
      amount_received DECIMAL(15,2) DEFAULT NULL,
      change_amount DECIMAL(15,2) DEFAULT NULL,
      status VARCHAR(50) DEFAULT 'completed',
      refund_status ENUM('none','partial','full') NOT NULL DEFAULT 'none',
      refund_total DECIMAL(15,2) NOT NULL DEFAULT 0.00,
      last_refunded_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
      paid_at DATETIME DEFAULT NULL COMMENT 'When the transaction was paid (status completed/paid)',
      contact_id INT DEFAULT NULL,
      customer_name VARCHAR(100) DEFAULT NULL,
      customer_unit INT DEFAULT NULL,
      note TEXT DEFAULT NULL,
      bank_name VARCHAR(100) DEFAULT NULL,
      card_number VARCHAR(50) DEFAULT NULL,
      cl_account_id INT DEFAULT NULL,
      cl_account_name VARCHAR(255) DEFAULT NULL,
      bank_id INT DEFAULT NULL,
      receipt_number INT DEFAULT NULL,
      transaction_type VARCHAR(50) DEFAULT 'drinks',
      PRIMARY KEY (id),
      UNIQUE KEY uk_transactions_uuid (uuid_id),
      KEY idx_business_created (business_id,created_at),
      KEY idx_user_id (user_id),
      KEY idx_shift_uuid (shift_uuid),
      KEY idx_status (status),
      KEY idx_created_at (created_at),
      KEY idx_receipt_number (receipt_number),
      KEY idx_transactions_sync_status (sync_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS transaction_items (
      id INT NOT NULL AUTO_INCREMENT,
      uuid_id VARCHAR(36) DEFAULT NULL,
      transaction_id INT NOT NULL,
      uuid_transaction_id VARCHAR(255) NOT NULL,
      product_id INT NOT NULL,
      quantity INT NOT NULL DEFAULT 1,
      unit_price DECIMAL(15,2) NOT NULL,
      total_price DECIMAL(15,2) NOT NULL,
      custom_note TEXT DEFAULT NULL,
      bundle_selections_json TEXT DEFAULT NULL,
      package_selections_json TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      waiter_id INT DEFAULT NULL,
      cancelled_by_user_id INT DEFAULT NULL,
      cancelled_by_waiter_id INT DEFAULT NULL,
      cancelled_at TIMESTAMP NULL DEFAULT NULL COMMENT 'When this item was cancelled',
      PRIMARY KEY (id),
      UNIQUE KEY uk_transaction_items_uuid (uuid_id),
      KEY idx_transaction_id (transaction_id),
      KEY idx_uuid_transaction_id (uuid_transaction_id),
      KEY idx_product_id (product_id),
      KEY idx_created_at (created_at),
      KEY idx_transaction_items_waiter (waiter_id),
      KEY idx_transaction_items_cancelled_by_user (cancelled_by_user_id),
      KEY idx_transaction_items_cancelled_by_waiter (cancelled_by_waiter_id),
      KEY idx_transaction_items_cancelled_at (cancelled_at),
      CONSTRAINT fk_ti_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS transaction_item_customizations (
      id INT NOT NULL AUTO_INCREMENT,
      transaction_item_id INT NOT NULL,
      uuid_transaction_item_id VARCHAR(36) NOT NULL,
      customization_type_id INT NOT NULL,
      bundle_product_id INT DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_transaction_item_id (transaction_item_id),
      KEY idx_uuid_transaction_item_id (uuid_transaction_item_id),
      KEY idx_customization_type_id (customization_type_id),
      KEY idx_bundle_product_id (bundle_product_id),
      KEY idx_item_type (transaction_item_id,customization_type_id),
      CONSTRAINT fk_tic_transaction_item FOREIGN KEY (transaction_item_id) REFERENCES transaction_items(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS transaction_item_customization_options (
      id INT NOT NULL AUTO_INCREMENT,
      transaction_item_customization_id INT NOT NULL,
      customization_option_id INT NOT NULL,
      option_name VARCHAR(255) NOT NULL,
      price_adjustment DECIMAL(15,2) NOT NULL DEFAULT 0.00,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_tic_id (transaction_item_customization_id),
      KEY idx_customization_option_id (customization_option_id),
      KEY idx_tico_composite (transaction_item_customization_id,customization_option_id),
      CONSTRAINT fk_tico_tic FOREIGN KEY (transaction_item_customization_id) REFERENCES transaction_item_customizations(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS transaction_refunds (
      id INT NOT NULL AUTO_INCREMENT,
      uuid_id CHAR(36) NOT NULL,
      transaction_uuid VARCHAR(255) NOT NULL,
      business_id INT NOT NULL,
      shift_uuid VARCHAR(255) DEFAULT NULL,
      refunded_by INT NOT NULL,
      refund_amount DECIMAL(15,2) NOT NULL,
      cash_delta DECIMAL(15,2) NOT NULL DEFAULT 0.00,
      payment_method_id INT NOT NULL,
      reason VARCHAR(255) DEFAULT NULL,
      note TEXT DEFAULT NULL,
      refund_type ENUM('full','partial') DEFAULT 'full',
      status ENUM('pending','completed','failed') DEFAULT 'completed',
      refunded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      synced_at DATETIME DEFAULT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_transaction_refunds_uuid (uuid_id),
      KEY idx_transaction_uuid (transaction_uuid),
      KEY idx_business_refunded_at (business_id,refunded_at),
      KEY idx_refunded_by (refunded_by),
      CONSTRAINT fk_tr_transaction FOREIGN KEY (transaction_uuid) REFERENCES transactions(uuid_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ];

  for (let i = 0; i < tables.length; i++) {
    const names = ['transactions', 'transaction_items', 'transaction_item_customizations', 'transaction_item_customization_options', 'transaction_refunds'];
    await executeSystemPosDdl(tables[i]);
    console.log(`[SYSTEM POS] Created/verified table: ${names[i]}`);
  }
  await ensureSystemPosQueueTable();
  console.log('[SYSTEM POS] Created/verified table: system_pos_queue');

  const alterColumns: string[] = [
    'ALTER TABLE transactions ADD COLUMN waiter_id INT DEFAULT NULL AFTER user_id',
    'ALTER TABLE transaction_items ADD COLUMN waiter_id INT DEFAULT NULL AFTER created_at',
    // Keep system_pos.transaction_items schema compatible with inserts from main DB.
    // These columns exist on main DB (some via lazy migrations); system_pos may be missing them on older installs.
    "ALTER TABLE transaction_items ADD COLUMN production_started_at TIMESTAMP NULL DEFAULT NULL",
    "ALTER TABLE transaction_items ADD COLUMN production_status ENUM('preparing','finished','cancelled') DEFAULT NULL",
    "ALTER TABLE transaction_items ADD COLUMN production_finished_at TIMESTAMP NULL DEFAULT NULL",
    "ALTER TABLE transaction_items ADD COLUMN package_line_finished_at_json TEXT DEFAULT NULL COMMENT 'Per-line finished-at times for package breakdown (JSON: {\"0\":\"iso\",...})'",
    "ALTER TABLE transaction_items ADD INDEX idx_transaction_items_production_status (production_status)",
    "ALTER TABLE transactions ADD COLUMN sync_status ENUM('pending','synced','failed') DEFAULT 'pending' AFTER payment_method_id",
    "ALTER TABLE products ADD COLUMN is_package TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = package product' AFTER is_bundle",
    'ALTER TABLE transactions ADD COLUMN sync_attempts INT DEFAULT 0 AFTER sync_status',
    'ALTER TABLE transactions ADD COLUMN synced_at DATETIME DEFAULT NULL AFTER synced_at',
    'ALTER TABLE transactions ADD COLUMN last_sync_attempt TIMESTAMP NULL DEFAULT NULL AFTER synced_at',
    'ALTER TABLE transactions ADD COLUMN table_id INT DEFAULT NULL',
    'ALTER TABLE transactions ADD COLUMN checker_printed TINYINT(1) NOT NULL DEFAULT 0 COMMENT \'1 = kitchen labels/checker already printed\'',
    'ALTER TABLE transactions ADD COLUMN paid_at DATETIME DEFAULT NULL COMMENT \'When the transaction was paid\' AFTER updated_at',
    'ALTER TABLE transactions ADD INDEX idx_transactions_sync_status (sync_status)',
    "ALTER TABLE transactions ADD COLUMN system_pos_synced_at DATETIME DEFAULT NULL COMMENT 'When refund data was last synced from main DB' AFTER last_refunded_at",
  ];
  for (const sql of alterColumns) {
    await executeSystemPosDdlIgnoreDup(sql);
  }

  const masterTables = ['organizations', 'roles', 'businesses', 'category1', 'category2', 'category2_businesses', 'products', 'product_customization_types', 'product_customization_options', 'bundle_items', 'package_items', 'package_item_products', 'users', 'employees_position', 'employees', 'payment_methods'] as const;
  for (const t of masterTables) {
    try {
      await executeSystemPosDdl(`CREATE TABLE IF NOT EXISTS \`${t}\` LIKE \`${mainDb}\`.\`${t}\``);
      console.log(`[SYSTEM POS] Created/verified table: ${t} (from main DB)`);
    } catch (e) {
      console.warn(`⚠️ [SYSTEM POS] Could not create ${t} from main DB (LIKE):`, (e as Error).message);
    }
  }
  console.log('[SYSTEM POS] Schema ensured.');
}

type QueryRow = { sql: string; params?: (string | number | null | boolean)[] };

async function upsertMasterDataToSystemPos(queries: QueryRow[]): Promise<void> {
  if (queries.length === 0) return;
  try {
    await ensureSystemPosSchema();
    await executeSystemPosTransaction(queries);
    console.log(`[SYSTEM POS] Upserted ${queries.length} master data row(s) to system_pos`);
  } catch (e) {
    console.warn('[SYSTEM POS] Failed to upsert master data to system_pos (non-fatal):', e instanceof Error ? e.message : String(e));
  }
}

function createWindows(): void {
  // Guard against double initialization
  if (windowsInitialized) {
    originalConsoleLog('⚠️ createWindows() already called, skipping re-initialization');
    return;
  }
  windowsInitialized = true;

  // Initialize MySQL database (local LAN database)
  try {
    originalConsoleLog('🔍 Initializing MySQL database connection...');

    // Initialize MySQL connection pool
    const mysqlPool = initializeMySQLPool();

    // Initialize MySQL schema
    initializeMySQLSchema().catch(err => {
      console.error('❌ Failed to initialize MySQL schema:', err);
    });

    // Run main-DB migrations (e.g. transaction_items.waiter_id) — ignore if column already exists
    // #region agent log
    void (async () => {
      try {
        fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'main.ts:before-waiter-migration', message: 'Before main DB waiter_id migration', data: {}, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'H1' }) }).catch(() => { });
        await executeDdlIgnoreDup('ALTER TABLE transaction_items ADD COLUMN waiter_id INT DEFAULT NULL COMMENT \'Employee who added this line item\' AFTER created_at');
        await executeDdlIgnoreDup('ALTER TABLE transaction_items ADD INDEX idx_transaction_items_waiter (waiter_id)');
        await executeDdlIgnoreDup('ALTER TABLE transactions ADD COLUMN paid_at DATETIME DEFAULT NULL COMMENT \'When the transaction was paid\' AFTER updated_at');
        fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'main.ts:after-waiter-migration', message: 'Main DB waiter_id migration completed', data: { success: true }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'H1' }) }).catch(() => { });
      } catch (migErr) {
        fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'main.ts:waiter-migration-error', message: 'Main DB waiter_id migration failed', data: { error: (migErr as Error)?.message }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'H1' }) }).catch(() => { });
        console.warn('⚠️ Main DB migration (transaction_items.waiter_id) failed (non-fatal):', (migErr as Error)?.message);
      }
    })();
    // #endregion

    // MySQL pool is already initialized above
    console.log('✅ MySQL database connection initialized (salespulse)');

    // Initialize System POS MySQL connection pool (for printer 2 transactions)
    initializeSystemPosPool();
    console.log('✅ System POS MySQL database connection initialized (system_pos)');
    ensureSystemPosSchema().catch(err => {
      console.error('❌ Failed to ensure system_pos schema:', err);
    });

    // Initialize printer management service with MySQL pool only
    try {
      printerService = new PrinterManagementService(mysqlPool);
      console.log('✅ Printer Management Service initialized with MySQL');
    } catch (printerServiceError) {
      console.error('❌ Failed to initialize Printer Management Service:', printerServiceError);
    }

    // Migrate slideshow images from /public/ to userData on first run
    try {
      const slideshowPath = getSlideshowPath();
      const publicSlideshowPath = path.join(process.cwd(), 'public', 'images', 'slideshow');

      if (fs.existsSync(publicSlideshowPath)) {
        const existingFiles = fs.readdirSync(slideshowPath);
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        const existingImages = existingFiles.filter((file: string) => {
          const ext = path.extname(file).toLowerCase();
          return imageExtensions.includes(ext);
        });

        if (existingImages.length === 0) {
          const publicFiles = fs.readdirSync(publicSlideshowPath);
          const imagesToMigrate = publicFiles.filter((file: string) => {
            const ext = path.extname(file).toLowerCase();
            return imageExtensions.includes(ext);
          });

          if (imagesToMigrate.length > 0) {
            console.log(`📸 Migrating ${imagesToMigrate.length} slideshow images from /public/ to userData...`);
            let migratedCount = 0;

            for (const file of imagesToMigrate) {
              try {
                const sourcePath = path.join(publicSlideshowPath, file);
                const destPath = path.join(slideshowPath, file);
                fs.copyFileSync(sourcePath, destPath);
                migratedCount++;
              } catch (error) {
                console.error('❌ Failed to migrate:', file, error);
              }
            }

            if (migratedCount > 0) {
              console.log(`✅ Migrated ${migratedCount} slideshow images to userData`);
            }
          }
        }
      }
    } catch (error) {
      console.error('❌ Error during slideshow migration:', error);
    }

    console.log('✅ MySQL database initialization completed');
  } catch (error) {
    originalConsoleError('❌ Failed to initialize MySQL:', error);
  }


  // Get all displays
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  const secondaryDisplay = displays.find(display => display.id !== primaryDisplay.id);

  console.log('🔍 Detected displays:', displays.length);
  console.log('🔍 All displays:', displays.map(d => ({ id: d.id, bounds: d.bounds, workArea: d.workArea })));
  console.log('🔍 Primary display:', primaryDisplay.bounds);
  if (secondaryDisplay) {
    console.log('🔍 Secondary display found:', secondaryDisplay.bounds);
  } else {
    console.log('❌ No secondary display detected');
  }

  // App icon path (so replacing public/256x256.png takes effect without rebuilding .exe)
  const iconPath = path.join(__dirname, '../public/256x256.png');
  const iconPathIco = path.join(__dirname, '../public/Momoyo.ico');
  const iconPathPictos = path.join(__dirname, '../public/pictos.ico');
  const appIcon = fs.existsSync(iconPathIco) ? iconPathIco
    : (fs.existsSync(iconPathPictos) ? iconPathPictos : (fs.existsSync(iconPath) ? iconPath : undefined));

  // Create main POS window (cashier display)
  // Start with login size (800x432), will be resized after successful login
  mainWindow = new BrowserWindow({
    width: 800,
    height: 432,
    center: true,
    minWidth: 800,
    minHeight: 432,
    title: 'Pictos - Login',
    frame: false,
    backgroundColor: '#111827',
    ...(appIcon ? { icon: appIcon } : {}),
    movable: true,
    resizable: false, // Don't allow resizing on login
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      devTools: true, // Enable dev tools for debugging
    },
    show: false,
  });

  // Create customer display window if secondary monitor is available
  if (secondaryDisplay) {
    console.log('🔍 Creating customer display window...');
    const { bounds } = secondaryDisplay;
    const customerWindowWidth = bounds.width;
    const customerWindowHeight = bounds.height;
    const customerWindowX = bounds.x;
    const customerWindowY = bounds.y;

    console.log('🔍 Customer window dimensions:', { width: customerWindowWidth, height: customerWindowHeight });
    console.log('🔍 Customer window position:', { x: customerWindowX, y: customerWindowY });

    customerWindow = new BrowserWindow({
      width: customerWindowWidth,
      height: customerWindowHeight,
      x: customerWindowX,
      y: customerWindowY,
      title: 'Pictos - Customer Display',
      frame: false,
      backgroundColor: '#000000',
      alwaysOnTop: true,
      kiosk: false, // Temporarily disable kiosk mode for debugging
      fullscreenable: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
      show: false,
    });

    console.log('✅ Customer window created successfully');

    // Load customer display page
    if (isDev) {
      setTimeout(async () => {
        console.log('🔍 Loading customer display page...');
        const tryLoadCustomerURL = async (port: number) => {
          try {
            await customerWindow!.loadURL(`http://localhost:${port}/customer-display`);
            console.log(`✅ Customer display page loaded successfully on port ${port}`);
            return true;
          } catch (error) {
            console.log(`❌ Failed to load customer display on port ${port}:`, error);
            return false;
          }
        };

        const preferredPort = Number(process.env.PORT ?? '');
        const fallbackPorts = [3000, 3001, 3002];
        const ports = [
          ...(Number.isFinite(preferredPort) ? [preferredPort] : []),
          ...fallbackPorts
        ].filter((port, index, arr) => arr.indexOf(port) === index);
        let loaded = false;

        for (const port of ports) {
          if (await tryLoadCustomerURL(port)) {
            loaded = true;
            break;
          }
        }

        if (!loaded) {
          console.error('❌ Failed to load customer display on any port');
        }
      }, 6000); // Load after main window
    } else {
      customerWindow.loadFile(path.join(__dirname, '../../out/customer-display.html'));
    }
  } else {
    console.log('❌ Cannot create customer display - no secondary monitor detected');
  }

  // Listen for navigation events
  mainWindow.webContents.on('did-navigate', (event, url) => {
    const currentURL = new URL(url);
    console.log('🔍 Navigation detected:', currentURL.pathname);

    const isLogin = currentURL.pathname === '/login' || currentURL.pathname.endsWith('login.html');

    if (isLogin) {
      // Keep login page at 800x432
      console.log('🔍 Login page detected - setting login window size');
      mainWindow!.setFullScreen(false);
      mainWindow!.setResizable(false);
      mainWindow!.setSize(800, 432);
      mainWindow!.center();
    } else {
      // Main POS page - set to fullscreen
      console.log('🔍 Main POS page detected - setting fullscreen');
      mainWindow!.setResizable(true);
      mainWindow!.setFullScreen(true);
    }
  });

  // Also listen for hash changes (for client-side routing)
  mainWindow.webContents.on('did-navigate-in-page', (event, url) => {
    const currentURL = new URL(url);
    console.log('🔍 In-page navigation detected:', currentURL.pathname);

    const isLogin = currentURL.pathname === '/login' || currentURL.pathname.endsWith('login.html');

    if (isLogin) {
      // Keep login page at 800x432
      console.log('🔍 Login page detected - setting login window size');
      mainWindow!.setFullScreen(false);
      mainWindow!.setResizable(false);
      mainWindow!.setSize(800, 432);
      mainWindow!.center();
    } else {
      // Main POS page - set to fullscreen
      console.log('🔍 Main POS page detected - setting fullscreen');
      mainWindow!.setResizable(true);
      mainWindow!.setFullScreen(true);
    }
  });

  // Add IPC handler for focusing window (fix for Windows 11 frameless window focus issue)
  ipcMain.handle('focus-window', async () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.focus();
        return { success: true };
      }
      return { success: false, error: 'Window not available' };
    } catch (error) {
      console.error('Error focusing window:', error);
      return { success: false, error: String(error) };
    }
  });

  // Listen for successful login via IPC - THIS is when we go fullscreen
  ipcMain.handle('login-success', async () => {
    console.log('🔍 [ELECTRON] Login success IPC received!');
    console.log('🔍 [ELECTRON] Main window exists:', !!mainWindow);
    console.log('🔍 [ELECTRON] Main window isDestroyed:', mainWindow?.isDestroyed());
    console.log('🔍 [ELECTRON] Main window isVisible:', mainWindow?.isVisible());
    console.log('🔍 [ELECTRON] Main window isFullScreen:', mainWindow?.isFullScreen());

    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('🔍 [ELECTRON] Setting fullscreen in 300ms...');
      setTimeout(() => {
        console.log('🔍 [ELECTRON] Now setting fullscreen...');
        try {
          mainWindow!.setResizable(true);
          console.log('🔍 [ELECTRON] Resizable set to true');
          mainWindow!.setFullScreen(true);
          console.log('🔍 [ELECTRON] Fullscreen set to true');
          console.log('🔍 [ELECTRON] Final isFullScreen:', mainWindow!.isFullScreen());
        } catch (error) {
          console.error('🔍 [ELECTRON] Error setting fullscreen:', error);
        }
      }, 300);
    } else {
      console.log('🔍 [ELECTRON] Cannot set fullscreen - window not available');
    }
    return { success: true };
  });

  // Configuration management IPC handlers
  ipcMain.handle('get-app-config', async () => {
    try {
      const config = readConfig();
      return { success: true, config: config || null };
    } catch (error) {
      console.error('❌ Failed to read app config:', error);
      return { success: false, error: String(error) };
    }
  });

  /** Returns the DB config actually used at runtime (for display in Login settings). source: 'saved' | 'env' | 'default' */
  ipcMain.handle('get-effective-db-config', async () => {
    try {
      const config = readConfig();
      const dbConfig = getDbConfig();
      const source = config?.serverHost ? 'saved' : (process.env.DB_HOST ? 'env' : 'default');
      return {
        success: true,
        host: dbConfig.host,
        database: dbConfig.database,
        port: dbConfig.port,
        source,
      };
    } catch (error) {
      console.error('❌ Failed to get effective DB config:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('save-app-config', async (event, config: AppConfig) => {
    try {
      const success = writeConfig(config);
      if (success) {
        console.log('✅ App config saved successfully');
        return { success: true };
      } else {
        return { success: false, error: 'Failed to write config file' };
      }
    } catch (error) {
      console.error('❌ Failed to save app config:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('reset-app-config', async () => {
    try {
      const success = resetConfig();
      if (success) {
        console.log('✅ App config reset successfully');
        return { success: true };
      } else {
        return { success: false, error: 'Failed to reset config file' };
      }
    } catch (error) {
      console.error('❌ Failed to reset app config:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('test-db-connection', async (event, config: AppConfig) => {
    try {
      const result = await testDatabaseConnection(config);
      return result;
    } catch (error) {
      console.error('❌ Failed to test database connection:', error);
      return { success: false, error: String(error) };
    }
  });

  // Listen for logout via IPC
  ipcMain.handle('logout', async () => {
    console.log('🔍 Logout - resizing back to login size');
    if (mainWindow) {
      mainWindow.setFullScreen(false);
      mainWindow.setResizable(false);
      mainWindow.setSize(800, 432);
      mainWindow.center();
    }
    return { success: true };
  });

  // Offline/local DB IPC
  ipcMain.handle('localdb-upsert-categories', async (event, rows: { category2_name: string; updated_at?: number }[]) => {
    try {
      // Legacy table - may not exist in MySQL schema, skip gracefully
      // Category2 table is the source of truth
      console.log('⚠️ [CATEGORIES] Skipping legacy categories table - category2 is source of truth');
      return { success: true };
    } catch (error) {
      console.error('Error upserting categories:', error);
      return { success: false };
    }
  });
  ipcMain.handle('localdb-get-categories', async (event, businessId?: number) => {
    try {
      // Get categories from products filtered by business (if businessId provided)
      // This ensures categories match the products available for the business
      let query = `SELECT DISTINCT c2.name AS category2_name, c2.updated_at, c2.display_order
        FROM category2 c2
        INNER JOIN products p ON p.category2_id = c2.id`;

      const params: number[] = [];

      // Add business filter if businessId is provided
      if (businessId) {
        query += ` INNER JOIN product_businesses pb ON p.id = pb.product_id`;
      }

      query += ` WHERE p.status = 'active' AND c2.is_active = 1`;

      if (businessId) {
        query += ` AND pb.business_id = ?`;
        params.push(businessId);
      }

      query += ` ORDER BY c2.display_order ASC, c2.name ASC`;

      return await executeQuery<{ category2_name: string; updated_at: number }>(query, params);
    } catch (error) {
      console.error('Error getting categories:', error);
      return [];
    }
  });
  ipcMain.handle('localdb-upsert-product-businesses', async (event, rows: Array<{ product_id: number; business_id: number }>) => {
    try {
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];

      // Verify business_id and product_id exist before inserting (foreign key constraints)
      const validJunctionData: Array<{ product_id: number; business_id: number }> = [];

      for (const rel of rows) {
        try {
          const [businessExists, productExists] = await Promise.all([
            executeQueryOne<{ id: number }>('SELECT id FROM businesses WHERE id = ? LIMIT 1', [rel.business_id]),
            executeQueryOne<{ id: number }>('SELECT id FROM products WHERE id = ? LIMIT 1', [rel.product_id])
          ]);
          if (!businessExists) {
            console.warn(`⚠️ [PRODUCT BUSINESSES UPSERT] Skipping: business_id ${rel.business_id} does not exist`);
            continue;
          }
          if (!productExists) {
            console.warn(`⚠️ [PRODUCT BUSINESSES UPSERT] Skipping: product_id ${rel.product_id} does not exist`);
            continue;
          }
          validJunctionData.push(rel);
        } catch (checkError) {
          console.warn(`⚠️ [PRODUCT BUSINESSES UPSERT] Error checking product_id ${rel.product_id}, business_id ${rel.business_id}:`, checkError);
          continue;
        }
      }

      if (validJunctionData.length > 0) {
        const junctionQueries = validJunctionData.map(rel => ({
          sql: `
            INSERT INTO product_businesses (product_id, business_id)
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE product_id=product_id
          `,
          params: [rel.product_id, rel.business_id]
        }));
        queries.push(...junctionQueries); console.log(`✅ [PRODUCT BUSINESSES UPSERT] Stored ${validJunctionData.length} product-business relationships (${rows.length - validJunctionData.length} skipped)`);
      } else {
        console.warn(`⚠️ [PRODUCT BUSINESSES UPSERT] No valid junction table data (all ${rows.length} skipped)`);
      }

      if (queries.length > 0) {
        await executeTransaction(queries);
      }
      return { success: true };
    } catch (error) {
      console.error('Error upserting product_businesses:', error); return { success: false };
    }
  });

  // Download product/business images from server and rewrite image_url to pos-image:// for offline use
  ipcMain.handle('download-and-rewrite-sync-images', async (_event, payload: { baseUrl: string; products: UnknownRecord[]; businesses: UnknownRecord[] }) => {
    try {
      const { baseUrl, products, businesses } = payload;
      const base = baseUrl.replace(/\/$/, '');
      const userData = app.getPath('userData');
      const dirs = [path.join(userData, 'images', 'products'), path.join(userData, 'images', 'businesses')];
      for (const d of dirs) {
        try { fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ }
      }
      const imagePathRe = /^\/images\/(products|businesses)\/([^/]+\.(webp|png|jpg|jpeg|gif))$/i;
      let downloadCount = 0;
      let rewriteCount = 0;
      let failCount = 0;
      const tryDownload = async (imageUrl: string): Promise<string> => {
        if (!imageUrl || typeof imageUrl !== 'string') return imageUrl;
        const m = imageUrl.match(imagePathRe);
        if (!m) {
          return imageUrl;
        }
        const [, sub, filename] = m;
        const fullUrl = `${base}${imageUrl}`;
        const localPath = path.join(userData, 'images', sub, filename);
        try {
          const res = await fetch(fullUrl);
          if (!res.ok) {
            failCount++;
            return `${base}${imageUrl}`;
          }
          const buf = await res.arrayBuffer();
          fs.writeFileSync(localPath, Buffer.from(buf));
          // Remove leading slash from imageUrl to avoid triple slash: pos-image:///images/... -> pos-image://images/...
          const rewritten = `pos-image://${imageUrl.startsWith('/') ? imageUrl.slice(1) : imageUrl}`;
          downloadCount++;
          rewriteCount++;
          return rewritten;
        } catch (err) {
          failCount++;
          return `${base}${imageUrl}`;
        }
      };
      for (const p of products || []) {
        if (p && typeof p.image_url === 'string') {
          (p as Record<string, unknown>).image_url = await tryDownload(p.image_url);
        }
      }
      for (const b of businesses || []) {
        if (b && typeof b.image_url === 'string') {
          (b as Record<string, unknown>).image_url = await tryDownload(b.image_url);
        }
      }
      return { products: products || [], businesses: businesses || [] };
    } catch (handlerError) {
      console.error('❌ [IMAGE DOWNLOAD] Handler error:', handlerError);
      return { products: payload.products || [], businesses: payload.businesses || [] };
    }
  });

  ipcMain.handle('localdb-upsert-products', async (event, rows: RowArray) => {
    console.log(`🔄 [PRODUCTS UPSERT] Received ${rows.length} products to upsert`);

    let successCount = 0;
    let errorCount = 0;
    const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];

    for (const r of rows) {
      try {
        // Type-safe property accessors
        const getId = () => (typeof r.id === 'number' || typeof r.id === 'string') ? Number(r.id) : null;
        const getString = (key: string) => (typeof r[key] === 'string' ? r[key] as string : '');
        const getNumber = (key: string) => {
          const val = r[key];
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getDate = (key: string) => {
          const val = r[key];
          if (val instanceof Date) return val;
          if (typeof val === 'string' || typeof val === 'number') return val;
          return null;
        };

        // Store all products regardless of harga_jual; use 0 when NULL so they show in POS (including offline tab)
        const hargaJualRaw = getNumber('harga_jual');
        const hargaJual = hargaJualRaw ?? 0;

        // Map MySQL columns
        const kategori = (typeof r.kategori === 'string' ? r.kategori : '') || (typeof r.category1_name === 'string' ? r.category1_name : '') || '';
        let category1Id = getNumber('category1_id');
        let category2Id = getNumber('category2_id');
        const category2Name = (typeof r.category2_name === 'string' ? r.category2_name : '') || (typeof r.jenis === 'string' ? r.jenis : '') || '';

        // If category1_id is missing but category1_name/kategori exists, try to map it
        if (!category1Id && (typeof r.category1_name === 'string' || typeof r.kategori === 'string')) {
          const categoryName = String(r.category1_name || r.kategori || '').toLowerCase().trim();
          if (categoryName === 'makanan' || categoryName === 'food') {
            category1Id = 1;
          } else if (categoryName === 'minuman' || categoryName === 'drinks' || categoryName === 'drink') {
            category1Id = 2;
          }
          if (category1Id) {
            console.log(`✅ [PRODUCTS UPSERT] Mapped category1_name "${r.category1_name || r.kategori}" to category1_id: ${category1Id}`);
          }
        }

        // If category2_id is missing but category2_name exists, try to look it up from category2 table
        if (!category2Id && category2Name) {
          try {
            const category2Lookup = await executeQueryOne<{ id: number }>('SELECT id FROM category2 WHERE name = ? LIMIT 1', [category2Name]);
            if (category2Lookup) {
              category2Id = category2Lookup.id;
              console.log(`✅ [PRODUCTS UPSERT] Looked up category2_id ${category2Id} for category2_name "${category2Name}"`);
            }
          } catch (lookupError) {
            console.warn(`⚠️ [PRODUCTS UPSERT] Failed to lookup category2_id for "${category2Name}":`, lookupError);
          }
        }

        // Verify category1_id exists before inserting (foreign key constraint)
        if (category1Id) {
          try {
            const category1Exists = await executeQueryOne<{ id: number }>('SELECT id FROM category1 WHERE id = ? LIMIT 1', [category1Id]);
            if (!category1Exists) {
              console.warn(`⚠️ [PRODUCTS UPSERT] category1_id ${category1Id} does not exist, setting to NULL`);
              category1Id = null;
            }
          } catch (checkError) {
            console.warn(`⚠️ [PRODUCTS UPSERT] Failed to verify category1_id ${category1Id}:`, checkError);
            category1Id = null;
          }
        }

        // Verify category2_id exists before inserting (foreign key constraint)
        if (category2Id) {
          try {
            const category2Exists = await executeQueryOne<{ id: number }>('SELECT id FROM category2 WHERE id = ? LIMIT 1', [category2Id]);
            if (!category2Exists) {
              console.warn(`⚠️ [PRODUCTS UPSERT] category2_id ${category2Id} does not exist, setting to NULL`);
              category2Id = null;
            }
          } catch (checkError) {
            console.warn(`⚠️ [PRODUCTS UPSERT] Failed to verify category2_id ${category2Id}:`, checkError);
            category2Id = null;
          }
        }

        const isBundle = (r.is_bundle === 1 || r.is_bundle === true) ? 1 : 0;
        const isPackage = (r.is_package === 1 || r.is_package === true) ? 1 : 0;
        const hasCustomization = (r.has_customization === 1 || r.has_customization === true) ? 1 : 0;

        const productId = getId();
        const menuCode = typeof r.menu_code === 'string' ? r.menu_code : (typeof r.menu_code === 'number' ? String(r.menu_code) : null);
        const nama = getString('nama');
        const satuan = getString('satuan') || '';
        const keterangan = typeof r.keterangan === 'string' ? r.keterangan : null;
        const hargaBeli = getNumber('harga_beli');
        const ppn = getNumber('ppn');
        const hargaKhusus = getNumber('harga_khusus');
        const hargaOnline = getNumber('harga_online');
        const hargaQpon = getNumber('harga_qpon');
        const hargaGofood = getNumber('harga_gofood');
        const hargaGrabfood = getNumber('harga_grabfood');
        const hargaShopeefood = getNumber('harga_shopeefood');
        const hargaTiktok = getNumber('harga_tiktok');
        const feeKerja = getNumber('fee_kerja');
        const imageUrl = typeof r.image_url === 'string' ? r.image_url : null;
        const status = typeof r.status === 'string' ? r.status : (typeof r.status === 'number' ? String(r.status) : null);
        const createdAt = getDate('created_at');
        const createdTimestamp = createdAt ? toMySQLTimestamp(createdAt as string | number | Date) : toMySQLTimestamp(new Date());

        queries.push({
          sql: `INSERT INTO products (
            id, menu_code, nama, satuan, category1_id, category2_id, keterangan,
            harga_beli, ppn, harga_jual, harga_khusus, harga_online, harga_qpon, harga_gofood, harga_grabfood, harga_shopeefood, harga_tiktok, fee_kerja, image_url, status, has_customization, is_bundle, is_package, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            menu_code=VALUES(menu_code),
            nama=VALUES(nama),
            satuan=VALUES(satuan),
            category1_id=VALUES(category1_id),
            category2_id=VALUES(category2_id),
            keterangan=VALUES(keterangan),
            harga_beli=VALUES(harga_beli),
            ppn=VALUES(ppn),
            harga_jual=VALUES(harga_jual),
            harga_khusus=VALUES(harga_khusus),
            harga_online=VALUES(harga_online),
            harga_qpon=VALUES(harga_qpon),
            harga_gofood=VALUES(harga_gofood),
            harga_grabfood=VALUES(harga_grabfood),
            harga_shopeefood=VALUES(harga_shopeefood),
            harga_tiktok=VALUES(harga_tiktok),
            fee_kerja=VALUES(fee_kerja),
            image_url=VALUES(image_url),
            status=VALUES(status),
            has_customization=VALUES(has_customization),
            is_bundle=VALUES(is_bundle),
            is_package=VALUES(is_package),
            updated_at=VALUES(updated_at)`,
          params: [
            productId, menuCode, nama, satuan, category1Id, category2Id, keterangan,
            hargaBeli, ppn, hargaJual, hargaKhusus, hargaOnline, hargaQpon, hargaGofood, hargaGrabfood, hargaShopeefood, hargaTiktok,
            feeKerja, imageUrl, status, hasCustomization, isBundle, isPackage,
            createdTimestamp, toMySQLTimestamp(Date.now())
          ]
        });
        successCount++;
      } catch (error) {
        errorCount++;
        const productId = (typeof r.id === 'number' || typeof r.id === 'string') ? Number(r.id) : 'unknown';
        const productName = typeof r.nama === 'string' ? r.nama : 'unknown';
        console.warn(`⚠️ [PRODUCTS UPSERT] Skipping product ${productId} (${productName}) due to error:`, error);
      }
    }

    try {
      if (queries.length > 0) {
        console.log(`🔄 [PRODUCTS UPSERT] Executing transaction with ${queries.length} queries...`);
        await executeTransaction(queries);
        await upsertMasterDataToSystemPos(queries);
        console.log(`✅ [PRODUCTS UPSERT] Transaction committed successfully`);
      } else {
        console.warn('⚠️ [PRODUCTS UPSERT] No queries to execute (all products were skipped)');
      }
      console.log(`✅ [PRODUCTS UPSERT] Completed: ${successCount} success, ${errorCount} errors`);
      return { success: true, inserted: successCount, errors: errorCount };
    } catch (error) {
      console.error('❌ [PRODUCTS UPSERT] Transaction failed:', error);
      console.error('❌ [PRODUCTS UPSERT] Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        queryCount: queries.length
      });
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('localdb-cleanup-orphaned-products', async (event, businessId: number, syncedProductIds: number[]) => {
    try {
      if (!Array.isArray(syncedProductIds) || syncedProductIds.length === 0) {
        console.log('ℹ️ [PRODUCTS CLEANUP] No synced product IDs provided, skipping cleanup');
        return { success: true, deletedCount: 0 };
      }

      // Find products that belong to this business but are NOT in the synced list
      const placeholders = syncedProductIds.map(() => '?').join(',');
      const orphanedProductsQuery = `
        SELECT DISTINCT p.id, p.nama
        FROM products p
        INNER JOIN product_businesses pb ON p.id = pb.product_id
        WHERE pb.business_id = ? AND p.id NOT IN (${placeholders})
      `;

      const orphanedProducts = await executeQuery<{ id: number; nama: string }>(
        orphanedProductsQuery,
        [businessId, ...syncedProductIds]
      );

      if (orphanedProducts.length === 0) {
        console.log('✅ [PRODUCTS CLEANUP] No orphaned products found');
        return { success: true, deletedCount: 0 };
      }

      const orphanedProductIds = orphanedProducts.map(p => p.id);
      console.log(`🧹 [PRODUCTS CLEANUP] Found ${orphanedProductIds.length} orphaned products to clean up: ${orphanedProductIds.join(', ')}`);

      const deletePlaceholders = orphanedProductIds.map(() => '?').join(',');

      // Delete in correct order to respect foreign key constraints
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];

      // 1. Delete product_customizations (references products)
      queries.push({
        sql: `DELETE FROM product_customizations WHERE product_id IN (${deletePlaceholders})`,
        params: [...orphanedProductIds]
      });

      // 2. Delete bundle_items where bundle_product_id is in orphaned products
      queries.push({
        sql: `DELETE FROM bundle_items WHERE bundle_product_id IN (${deletePlaceholders})`,
        params: [...orphanedProductIds]
      });

      // 3. Delete package_item_products -> package_items where package_product_id is in orphaned products
      queries.push({
        sql: `DELETE FROM package_items WHERE package_product_id IN (${deletePlaceholders})`,
        params: [...orphanedProductIds]
      });

      // 3. Delete product_businesses relationships for orphaned products
      queries.push({
        sql: `DELETE FROM product_businesses WHERE product_id IN (${deletePlaceholders}) AND business_id = ?`,
        params: [...orphanedProductIds, businessId]
      });

      // 4. Finally, delete the products themselves
      queries.push({
        sql: `DELETE FROM products WHERE id IN (${deletePlaceholders})`,
        params: [...orphanedProductIds]
      });

      await executeTransaction(queries);
      console.log(`✅ [PRODUCTS CLEANUP] Successfully deleted ${orphanedProductIds.length} orphaned products and their related data`);

      return { success: true, deletedCount: orphanedProductIds.length, deletedProductIds: orphanedProductIds };
    } catch (error) {
      console.error('❌ [PRODUCTS CLEANUP] Failed to cleanup orphaned products:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Mark bundle_items as inactive if not in synced list (soft-delete sync)
  ipcMain.handle('localdb-mark-inactive-bundle-items', async (_event, businessId: number, syncedBundleItemIds: number[]) => {
    try {
      const params: (string | number)[] = [businessId];
      let sql: string;
      if (Array.isArray(syncedBundleItemIds) && syncedBundleItemIds.length > 0) {
        const placeholders = syncedBundleItemIds.map(() => '?').join(',');
        sql = `UPDATE bundle_items SET is_active = 0 WHERE bundle_product_id IN (SELECT product_id FROM product_businesses WHERE business_id = ?) AND id NOT IN (${placeholders})`;
        params.push(...syncedBundleItemIds);
      } else {
        sql = `UPDATE bundle_items SET is_active = 0 WHERE bundle_product_id IN (SELECT product_id FROM product_businesses WHERE business_id = ?)`;
      }
      await executeUpdate(sql, params);
      return { success: true };
    } catch (error) {
      console.error('❌ [MARK INACTIVE] bundle_items:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Mark package_items as inactive if not in synced list (soft-delete sync)
  ipcMain.handle('localdb-mark-inactive-package-items', async (_event, businessId: number, syncedPackageItemIds: number[]) => {
    try {
      const params: (string | number)[] = [businessId];
      let sql: string;
      if (Array.isArray(syncedPackageItemIds) && syncedPackageItemIds.length > 0) {
        const placeholders = syncedPackageItemIds.map(() => '?').join(',');
        sql = `UPDATE package_items SET is_active = 0 WHERE package_product_id IN (SELECT product_id FROM product_businesses WHERE business_id = ?) AND id NOT IN (${placeholders})`;
        params.push(...syncedPackageItemIds);
      } else {
        sql = `UPDATE package_items SET is_active = 0 WHERE package_product_id IN (SELECT product_id FROM product_businesses WHERE business_id = ?)`;
      }
      await executeUpdate(sql, params);
      return { success: true };
    } catch (error) {
      console.error('❌ [MARK INACTIVE] package_items:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Mark package_item_products as inactive if not in synced list (soft-delete sync)
  ipcMain.handle('localdb-mark-inactive-package-item-products', async (_event, businessId: number, syncedPackageItemProductIds: number[]) => {
    try {
      const params: (string | number)[] = [businessId];
      let sql: string;
      if (Array.isArray(syncedPackageItemProductIds) && syncedPackageItemProductIds.length > 0) {
        const placeholders = syncedPackageItemProductIds.map(() => '?').join(',');
        sql = `UPDATE package_item_products SET is_active = 0 WHERE package_item_id IN (SELECT id FROM package_items WHERE package_product_id IN (SELECT product_id FROM product_businesses WHERE business_id = ?)) AND id NOT IN (${placeholders})`;
        params.push(...syncedPackageItemProductIds);
      } else {
        sql = `UPDATE package_item_products SET is_active = 0 WHERE package_item_id IN (SELECT id FROM package_items WHERE package_product_id IN (SELECT product_id FROM product_businesses WHERE business_id = ?))`;
      }
      await executeUpdate(sql, params);
      return { success: true };
    } catch (error) {
      console.error('❌ [MARK INACTIVE] package_item_products:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('localdb-get-products-by-jenis', async (event, jenis: string, businessId?: number) => {
    try {
      let query = `SELECT 
        p.id, p.menu_code, p.nama, p.satuan, 
        c2.name AS category2_name, c1.name AS category1_name,
        p.keterangan, p.harga_beli, p.ppn, p.harga_jual, p.harga_khusus, 
        p.harga_online, p.harga_qpon, p.harga_gofood, p.harga_grabfood, 
        p.harga_shopeefood, p.harga_tiktok, p.fee_kerja, p.image_url, p.status, p.has_customization, p.is_bundle
        FROM products p
        LEFT JOIN category2 c2 ON p.category2_id = c2.id
        LEFT JOIN category1 c1 ON p.category1_id = c1.id`;

      const params: (string | number)[] = [];

      // Add business filter if businessId is provided
      if (businessId) {
        query += ` INNER JOIN product_businesses pb ON p.id = pb.product_id`;
      }

      query += ` WHERE c2.name = ? AND p.status = 'active'`;
      params.push(jenis);

      if (businessId) {
        query += ` AND pb.business_id = ?`;
        params.push(businessId);
      }

      query += ` ORDER BY p.nama ASC`;

      return await executeQuery(query, params);
    } catch (error) {
      console.error('Error getting products by jenis:', error);
      return [];
    }
  });

  // Add the missing method for category2 filtering
  ipcMain.handle('localdb-get-products-by-category2', async (event, category2Name: string, businessId?: number) => {
    try {
      let query = `SELECT 
        p.id, p.menu_code, p.nama, p.satuan, 
        c2.name AS category2_name, c1.name AS category1_name,
        p.keterangan, p.harga_beli, p.ppn, p.harga_jual, p.harga_khusus, 
        p.harga_online, p.harga_qpon, p.harga_gofood, p.harga_grabfood, 
        p.harga_shopeefood, p.harga_tiktok, p.fee_kerja, p.image_url, p.status, p.has_customization, p.is_bundle, p.is_package
        FROM products p
        LEFT JOIN category2 c2 ON p.category2_id = c2.id
        LEFT JOIN category1 c1 ON p.category1_id = c1.id`;

      const params: (string | number)[] = [];

      // Filter by businessId using junction table (product_businesses)
      // Note: Only using junction table because p.business_id column doesn't exist in this MySQL schema
      // ALWAYS apply business filter when businessId is provided (don't fallback to all products)
      if (businessId) {
        query += ` INNER JOIN product_businesses pb ON p.id = pb.product_id`;
      }

      query += ` WHERE c2.name = ? AND p.status = 'active' AND p.harga_jual IS NOT NULL`;
      params.push(category2Name);

      if (businessId) {
        // Use junction table only (p.business_id column doesn't exist in this schema)
        query += ` AND pb.business_id = ?`;
        params.push(businessId);
      }

      query += ` ORDER BY p.nama ASC`; const result = await executeQuery(query, params); return result;
    } catch (error) {
      console.error('Error getting products by category2:', error);
      return [];
    }
  });
  ipcMain.handle('localdb-get-all-products', async (event, businessId?: number) => {
    try {
      let query = `SELECT 
        p.id, p.menu_code, p.nama, p.satuan, 
        c2.name AS category2_name, c1.name AS category1_name,
        p.keterangan, p.harga_beli, p.ppn, p.harga_jual, p.harga_khusus, 
        p.harga_online, p.harga_qpon, p.harga_gofood, p.harga_grabfood, 
        p.harga_shopeefood, p.harga_tiktok, p.fee_kerja, p.image_url, p.status, p.has_customization, p.is_bundle, p.is_package
        FROM products p
        LEFT JOIN category2 c2 ON p.category2_id = c2.id
        LEFT JOIN category1 c1 ON p.category1_id = c1.id`;

      const params: number[] = [];

      // Filter by businessId using junction table (product_businesses)
      // Note: Only using junction table because p.business_id column doesn't exist in this MySQL schema
      // ALWAYS apply business filter when businessId is provided (don't fallback to all products)
      if (businessId) {
        query += ` INNER JOIN product_businesses pb ON p.id = pb.product_id`;
      }

      query += ` WHERE p.status = 'active' AND p.harga_jual IS NOT NULL`;

      if (businessId) {
        // Use junction table only (p.business_id column doesn't exist in this schema)
        query += ` AND pb.business_id = ?`;
        params.push(businessId);
      }

      query += ` ORDER BY p.nama ASC`;
      const result = await executeQuery(query, params);
      return result;
    } catch (error) {
      console.error('Error getting all products:', error);
      return [];
    }
  });

  // Customization handlers
  ipcMain.handle('localdb-upsert-customization-types', async (event, rows: RowArray) => {
    try {
      const queries = rows.map(r => {
        const getId = () => {
          const val = r.id;
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getString = (key: string) => (typeof r[key] === 'string' ? r[key] as string : null);
        const getNumber = (key: string) => {
          const val = r[key];
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        return {
          sql: `INSERT INTO product_customization_types (
            id, name, selection_mode, display_order
          ) VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name=VALUES(name), selection_mode=VALUES(selection_mode),
            display_order=VALUES(display_order)`,
          params: [
            getId(),
            getString('name'),
            getString('selection_mode'),
            getNumber('display_order') ?? 0
          ]
        };
      });
      await executeTransaction(queries);
      if (queries.length > 0) await upsertMasterDataToSystemPos(queries);
      return { success: true };
    } catch (error) {
      console.error('Error upserting customization types:', error);
      return { success: false };
    }
  });

  ipcMain.handle('localdb-upsert-customization-options', async (event, rows: RowArray) => {
    try {
      const queries = rows.map(r => {
        const getId = () => {
          const val = r.id;
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getString = (key: string) => (typeof r[key] === 'string' ? r[key] as string : null);
        const getNumber = (key: string) => {
          const val = r[key];
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        return {
          sql: `INSERT INTO product_customization_options (
            id, type_id, name, price_adjustment, display_order, status
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            type_id=VALUES(type_id), name=VALUES(name), price_adjustment=VALUES(price_adjustment),
            display_order=VALUES(display_order), status=VALUES(status)`,
          params: [
            getId(),
            getNumber('type_id'),
            getString('name'),
            getNumber('price_adjustment') ?? 0.0,
            getNumber('display_order') ?? 0,
            getString('status') || 'active'
          ]
        };
      });
      await executeTransaction(queries);
      if (queries.length > 0) await upsertMasterDataToSystemPos(queries);
      return { success: true };
    } catch (error) {
      console.error('Error upserting customization options:', error);
      return { success: false };
    }
  });

  ipcMain.handle('localdb-upsert-product-customizations', async (event, rows: RowArray) => {
    try {
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];
      for (const r of rows) {
        try {
          const getId = () => {
            const val = r.id;
            if (typeof val === 'number') return val;
            if (typeof val === 'string') {
              const num = Number(val);
              return isNaN(num) ? null : num;
            }
            return null;
          };
          const getNumber = (key: string) => {
            const val = r[key];
            if (typeof val === 'number') return val;
            if (typeof val === 'string') {
              const num = Number(val);
              return isNaN(num) ? null : num;
            }
            return null;
          };
          queries.push({
            sql: `INSERT INTO product_customizations (
              id, product_id, customization_type_id
            ) VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE
              product_id=VALUES(product_id), customization_type_id=VALUES(customization_type_id)`,
            params: [
              getId(),
              getNumber('product_id'),
              getNumber('customization_type_id')
            ]
          });
        } catch (error) {
          const rowId = typeof r.id === 'number' ? r.id : (typeof r.id === 'string' ? r.id : 'unknown');
          console.warn(`⚠️ [PRODUCT CUSTOMIZATION UPSERT] Skipping row ${rowId} due to error:`, error);
        }
      }
      if (queries.length > 0) {
        await executeTransaction(queries);
      }
      return { success: true };
    } catch (error) {
      console.error('Error upserting product customizations:', error);
      return { success: false };
    }
  });

  // Bundle items handlers
  ipcMain.handle('localdb-get-bundle-items', async (event, productId: number | string) => {
    try {
      // Ensure productId is a number
      const productIdNum = typeof productId === 'string' ? parseInt(productId, 10) : productId;
      if (isNaN(productIdNum)) {
        console.error(`❌ [BUNDLE ITEMS] Invalid product ID: ${productId}`);
        return [];
      }

      console.log(`🔍 [BUNDLE ITEMS] Fetching bundle items for product ID: ${productIdNum} (type: ${typeof productId}, converted from: ${productId})`);

      // First, check if any bundle items exist at all
      const allBundleItems = await executeQuery<{ bundle_product_id: number; count: number }>('SELECT bundle_product_id, COUNT(*) as count FROM bundle_items GROUP BY bundle_product_id');
      console.log(`📊 [BUNDLE ITEMS] Bundle items by product:`, allBundleItems);

      const bundleItems = await executeQuery<BundleItemRow>(`
        SELECT 
          bi.id,
          bi.bundle_product_id,
          bi.category2_id,
          bi.required_quantity,
          bi.display_order,
          c2.name AS category2_name
        FROM bundle_items bi
        LEFT JOIN category2 c2 ON bi.category2_id = c2.id
        WHERE bi.bundle_product_id = ? AND (COALESCE(bi.is_active, 1) = 1)
        ORDER BY bi.display_order ASC
      `, [productIdNum]);

      console.log(`✅ [BUNDLE ITEMS] Found ${bundleItems.length} bundle items for product ${productIdNum}`);
      if (bundleItems.length > 0) {
        console.log(`📦 [BUNDLE ITEMS] First item:`, JSON.stringify(bundleItems[0], null, 2));
      } else {
        console.warn(`⚠️ [BUNDLE ITEMS] No bundle items found for product ${productIdNum}. Checking if product exists in products table...`);
        const productCheck = await executeQueryOne('SELECT id, nama, is_bundle FROM products WHERE id = ?', [productIdNum]);
        console.log(`🔍 [BUNDLE ITEMS] Product check result:`, productCheck);
      }

      return bundleItems.map(item => ({
        id: item.id,
        bundle_product_id: item.bundle_product_id,
        category2_id: item.category2_id,
        category2_name: item.category2_name,
        required_quantity: item.required_quantity,
        display_order: item.display_order
      }));
    } catch (error: unknown) {
      const errorMessage = (error && typeof error === 'object' && 'message' in error)
        ? String((error as { message: unknown }).message)
        : String(error);
      console.error(`❌ [BUNDLE ITEMS] Error fetching bundle items for product ${productId}:`, errorMessage);
      return [];
    }
  });

  ipcMain.handle('localdb-upsert-bundle-items', async (event, rows: RowArray) => {
    try {
      if (!Array.isArray(rows)) {
        console.error(`❌ [BUNDLE ITEMS UPSERT] Invalid data: rows is not an array, got ${typeof rows}`);
        return { success: false };
      }

      console.log(`🔄 [BUNDLE ITEMS UPSERT] Upserting ${rows.length} bundle items`);
      if (rows.length > 0) {
        console.log(`📦 [BUNDLE ITEMS UPSERT] First item sample:`, JSON.stringify(rows[0], null, 2));
      }

      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];
      let successCount = 0;
      let errorCount = 0;

      for (const r of rows) {
        try {
          const getId = () => {
            const val = r.id;
            if (typeof val === 'number') return val;
            if (typeof val === 'string') {
              const num = Number(val);
              return isNaN(num) ? null : num;
            }
            return null;
          };
          const getNumber = (key: string) => {
            const val = r[key];
            if (typeof val === 'number') return val;
            if (typeof val === 'string') {
              const num = Number(val);
              return isNaN(num) ? null : num;
            }
            return null;
          };
          const getDate = (key: string) => {
            const val = r[key];
            if (val instanceof Date) return val;
            if (typeof val === 'string' || typeof val === 'number') return val;
            return null;
          };

          const bundleProductId = getNumber('bundle_product_id');
          const rowId = getId();

          // Skip if bundle_product_id is null or invalid
          if (!bundleProductId) {
            errorCount++;
            console.warn(`⚠️ [BUNDLE ITEMS UPSERT] Skipping row ${rowId}: bundle_product_id is null`);
            continue;
          }

          // Verify product exists before inserting bundle item
          try {
            const productExists = await executeQueryOne<{ id: number }>('SELECT id FROM products WHERE id = ? LIMIT 1', [bundleProductId]);
            if (!productExists) {
              console.warn(`⚠️ [BUNDLE ITEMS UPSERT] Skipping row ${rowId}: bundle_product_id ${bundleProductId} does not exist`);
              errorCount++;
              continue;
            }
          } catch (checkError) {
            console.warn(`⚠️ [BUNDLE ITEMS UPSERT] Error checking product ${bundleProductId} for bundle item ${rowId}:`, checkError);
            errorCount++;
            continue;
          }

          // Verify category2_id exists before inserting (foreign key constraint)
          // category2_id is NOT NULL in schema, so skip if it doesn't exist
          let category2Id = getNumber('category2_id');
          if (category2Id) {
            try {
              const category2Exists = await executeQueryOne<{ id: number }>('SELECT id FROM category2 WHERE id = ? LIMIT 1', [category2Id]);
              if (!category2Exists) {
                console.warn(`⚠️ [BUNDLE ITEMS UPSERT] Skipping row ${rowId}: category2_id ${category2Id} does not exist (required, cannot be NULL)`);
                errorCount++;
                continue;
              }
            } catch (checkError) {
              const category2IdRaw = getNumber('category2_id');
              console.warn(`⚠️ [BUNDLE ITEMS UPSERT] Error checking category2_id ${category2IdRaw} for bundle item ${rowId}:`, checkError);
              errorCount++;
              continue;
            }
          } else {
            console.warn(`⚠️ [BUNDLE ITEMS UPSERT] Skipping row ${rowId}: category2_id is null (required)`);
            errorCount++;
            continue;
          }

          const createdAtRaw = getDate('created_at');
          const updatedAtRaw = getDate('updated_at');
          const createdAt = createdAtRaw ? toMySQLTimestamp(createdAtRaw as string | number | Date) : toMySQLTimestamp(new Date());
          const updatedAt = updatedAtRaw ? toMySQLTimestamp(updatedAtRaw as string | number | Date) : toMySQLTimestamp(Date.now());

          const isActive = r.is_active !== undefined ? (r.is_active ? 1 : 0) : 1;
          queries.push({
            sql: `
              INSERT INTO bundle_items (
                id, bundle_product_id, category2_id, required_quantity, display_order, is_active, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                bundle_product_id = VALUES(bundle_product_id),
                category2_id = VALUES(category2_id),
                required_quantity = VALUES(required_quantity),
                display_order = VALUES(display_order),
                is_active = VALUES(is_active),
                updated_at = VALUES(updated_at)
            `,
            params: [
              rowId,
              bundleProductId,
              category2Id,
              getNumber('required_quantity'),
              getNumber('display_order'),
              isActive,
              createdAt,
              updatedAt
            ]
          });
          successCount++;
        } catch (rowError: unknown) {
          errorCount++;
          const rowId = typeof r.id === 'number' ? r.id : (typeof r.id === 'string' ? r.id : 'unknown');
          const rowErrorMessage = (rowError && typeof rowError === 'object' && 'message' in rowError)
            ? String((rowError as { message: unknown }).message)
            : String(rowError);
          console.warn(`⚠️ [BUNDLE ITEMS UPSERT] Skipping row ${rowId}: ${rowErrorMessage}`);
        }
      }

      if (queries.length > 0) {
        await executeTransaction(queries);
      }
      console.log(`📊 [BUNDLE ITEMS UPSERT] Upserted ${successCount} items, ${errorCount} errors`);
      console.log(`✅ [BUNDLE ITEMS UPSERT] Successfully upserted bundle items`);

      // Verify the data was saved
      const verifyCount = await executeQueryOne<{ count: number }>('SELECT COUNT(*) as count FROM bundle_items');
      console.log(`✅ [BUNDLE ITEMS UPSERT] Total bundle items in database: ${verifyCount?.count || 0}`);

      return { success: true };
    } catch (error: unknown) {
      const errorMessage = (error && typeof error === 'object' && 'message' in error)
        ? String((error as { message: unknown }).message)
        : String(error);
      console.error(`❌ [BUNDLE ITEMS UPSERT] Error:`, errorMessage);
      return { success: false };
    }
  });

  // Package items for POS: items + choice products for flexible
  ipcMain.handle('localdb-get-package-items', async (_event, packageProductId: number | string) => {
    try {
      const id = typeof packageProductId === 'string' ? parseInt(packageProductId, 10) : packageProductId;
      if (isNaN(id)) return [];
      const items = await executeQuery<{
        id: number;
        package_product_id: number;
        selection_type: string;
        product_id: number | null;
        required_quantity: number;
        display_order: number;
        product_name: string | null;
      }>(`
        SELECT
          pi.id,
          pi.package_product_id,
          pi.selection_type,
          pi.product_id,
          pi.required_quantity,
          pi.display_order,
          p.nama AS product_name
        FROM package_items pi
        LEFT JOIN products p ON pi.product_id = p.id
        WHERE pi.package_product_id = ? AND (COALESCE(pi.is_active, 1) = 1)
        ORDER BY pi.display_order ASC
      `, [id]);
      const itemIds = items.map(i => i.id);
      if (itemIds.length === 0) return items.map(pi => ({ ...pi, choice_products: [] }));
      const placeholders = itemIds.map(() => '?').join(',');
      const choices = await executeQuery<{ package_item_id: number; product_id: number; product_name: string; display_order: number }>(`
        SELECT pip.package_item_id, pip.product_id, p.nama AS product_name, pip.display_order
        FROM package_item_products pip
        INNER JOIN products p ON pip.product_id = p.id
        WHERE pip.package_item_id IN (${placeholders}) AND (COALESCE(pip.is_active, 1) = 1)
        ORDER BY pip.package_item_id, pip.display_order ASC
      `, itemIds);
      const choiceByItem: Record<number, { id: number; nama: string }[]> = {};
      for (const c of choices) {
        if (!choiceByItem[c.package_item_id]) choiceByItem[c.package_item_id] = [];
        choiceByItem[c.package_item_id].push({ id: c.product_id, nama: c.product_name });
      }
      return items.map(pi => ({
        id: pi.id,
        package_product_id: pi.package_product_id,
        selection_type: pi.selection_type,
        product_id: pi.product_id,
        required_quantity: pi.required_quantity,
        display_order: pi.display_order,
        product_name: pi.product_name || null,
        choice_products: choiceByItem[pi.id] || []
      }));
    } catch (err) {
      console.error('localdb-get-package-items error:', err);
      return [];
    }
  });

  // Package items (for packages - product with is_package=1)
  ipcMain.handle('localdb-upsert-package-items', async (event, rows: RowArray) => {
    try {
      if (!Array.isArray(rows)) return { success: false };
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];
      for (const r of rows) {
        const getId = () => {
          const val = r.id;
          if (typeof val === 'number') return val;
          if (typeof val === 'string') { const n = Number(val); return isNaN(n) ? null : n; }
          return null;
        };
        const getNumber = (k: string) => {
          const val = r[k];
          if (typeof val === 'number') return val;
          if (typeof val === 'string') { const n = Number(val); return isNaN(n) ? null : n; }
          return null;
        };
        const getString = (k: string) => (typeof r[k] === 'string' ? r[k] as string : null);
        const getDate = (k: string) => {
          const val = r[k];
          if (val instanceof Date) return val;
          if (typeof val === 'string' || typeof val === 'number') return val;
          return null;
        };
        const packageProductId = getNumber('package_product_id');
        if (!packageProductId) continue;
        const rowId = getId();
        const selectionType = getString('selection_type') || 'default';
        const productId = getNumber('product_id');
        const requiredQty = getNumber('required_quantity') ?? 1;
        const displayOrder = getNumber('display_order') ?? 0;
        const createdAtRaw = getDate('created_at');
        const updatedAtRaw = getDate('updated_at');
        const createdAt = createdAtRaw ? toMySQLTimestamp(createdAtRaw as string | number | Date) : toMySQLTimestamp(new Date());
        const updatedAt = updatedAtRaw ? toMySQLTimestamp(updatedAtRaw as string | number | Date) : toMySQLTimestamp(Date.now());
        const isActive = r.is_active !== undefined ? (r.is_active ? 1 : 0) : 1;
        queries.push({
          sql: `INSERT INTO package_items (
            id, package_product_id, selection_type, product_id, required_quantity, display_order, is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            package_product_id=VALUES(package_product_id),
            selection_type=VALUES(selection_type),
            product_id=VALUES(product_id),
            required_quantity=VALUES(required_quantity),
            display_order=VALUES(display_order),
            is_active=VALUES(is_active),
            updated_at=VALUES(updated_at)`,
          params: [rowId, packageProductId, selectionType, productId, requiredQty, displayOrder, isActive, createdAt, updatedAt]
        });
      }
      if (queries.length > 0) {
        await executeTransaction(queries);
        await upsertMasterDataToSystemPos(queries);
      }
      return { success: true };
    } catch (error) {
      console.error('Error upserting package items:', error);
      return { success: false };
    }
  });

  // Package item products (for flexible package items - which products can be chosen)
  ipcMain.handle('localdb-upsert-package-item-products', async (event, rows: RowArray) => {
    try {
      if (!Array.isArray(rows)) return { success: false };
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];
      for (const r of rows) {
        const getId = () => {
          const val = r.id;
          if (typeof val === 'number') return val;
          if (typeof val === 'string') { const n = Number(val); return isNaN(n) ? null : n; }
          return null;
        };
        const getNumber = (k: string) => {
          const val = r[k];
          if (typeof val === 'number') return val;
          if (typeof val === 'string') { const n = Number(val); return isNaN(n) ? null : n; }
          return null;
        };
        const getDate = (k: string) => {
          const val = r[k];
          if (val instanceof Date) return val;
          if (typeof val === 'string' || typeof val === 'number') return val;
          return null;
        };
        const packageItemId = getNumber('package_item_id');
        const productId = getNumber('product_id');
        if (!packageItemId || !productId) continue;
        const rowId = getId();
        const displayOrder = getNumber('display_order') ?? 0;
        const createdAtRaw = getDate('created_at');
        const createdAt = createdAtRaw ? toMySQLTimestamp(createdAtRaw as string | number | Date) : toMySQLTimestamp(new Date());
        const isActive = r.is_active !== undefined ? (r.is_active ? 1 : 0) : 1;
        queries.push({
          sql: `INSERT INTO package_item_products (
            id, package_item_id, product_id, display_order, is_active, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            display_order=VALUES(display_order),
            is_active=VALUES(is_active)`,
          params: [rowId, packageItemId, productId, displayOrder, isActive, createdAt]
        });
      }
      if (queries.length > 0) {
        await executeTransaction(queries);
        await upsertMasterDataToSystemPos(queries);
      }
      return { success: true };
    } catch (error) {
      console.error('Error upserting package item products:', error);
      return { success: false };
    }
  });

  // Debug handler to list all bundle items
  ipcMain.handle('localdb-debug-bundle-items', async () => {
    try {
      const allItems = await executeQuery<BundleItemRow>(`
        SELECT 
          bi.id,
          bi.bundle_product_id,
          bi.category2_id,
          bi.required_quantity,
          bi.display_order,
          c2.name AS category2_name
        FROM bundle_items bi
        LEFT JOIN category2 c2 ON bi.category2_id = c2.id
        ORDER BY bi.bundle_product_id, bi.display_order ASC
      `);

      console.log(`🔍 [DEBUG] Total bundle items in database: ${allItems.length}`);
      if (allItems.length > 0) {
        console.log(`📦 [DEBUG] All bundle items:`, JSON.stringify(allItems, null, 2));
      }

      return { success: true, items: allItems };
    } catch (error: unknown) {
      const errorMessage = (error && typeof error === 'object' && 'message' in error)
        ? String((error as { message: unknown }).message)
        : String(error);
      console.error(`❌ [DEBUG] Error listing bundle items:`, errorMessage);
      return { success: false, items: [], error: errorMessage };
    }
  });

  ipcMain.handle('localdb-get-product-customizations', async (event, productId: number) => {
    try {
      console.log(`🔍 [OFFLINE] Fetching customizations for product ${productId}`);

      // Get customization types for this product
      const types = await executeQuery<CustomizationTypeRow>(`
        SELECT DISTINCT ct.id, ct.name, ct.selection_mode, ct.display_order
        FROM product_customization_types ct
        INNER JOIN product_customizations pc ON ct.id = pc.customization_type_id
        WHERE pc.product_id = ?
        ORDER BY ct.display_order ASC, ct.name ASC
      `, [productId]);
      console.log(`📋 [OFFLINE] Found ${types.length} customization types for product ${productId}`, types);

      // For each type, get all available options (not just for this product)
      const customizations = await Promise.all(types.map(async (type) => {
        const options = await executeQuery<CustomizationOptionRow>(`
          SELECT co.id, co.type_id, co.name, co.price_adjustment, co.display_order
          FROM product_customization_options co
          WHERE co.type_id = ? AND co.status = 'active'
          ORDER BY co.display_order ASC, co.name ASC
        `, [type.id]);
        console.log(`📋 [OFFLINE] Type "${type.name}": found ${options.length} options`, options);

        return {
          id: type.id,
          name: type.name,
          selection_mode: type.selection_mode,
          options: options.map((option) => ({
            id: option.id,
            type_id: option.type_id,
            name: option.name,
            price_adjustment: Number(option.price_adjustment || 0),
            display_order: option.display_order
          }))
        };
      }));

      console.log(`✅ [OFFLINE] Returning ${customizations.length} customizations:`, customizations);
      return customizations;
    } catch (error) {
      console.error('❌ Error getting product customizations:', error);
      return [];
    }
  });

  ipcMain.handle('localdb-update-sync-status', async (event, key: string, status: string) => {
    try {
      // 'key' is a reserved word in MySQL, need to escape it with backticks
      // Table may not exist - handle gracefully
      await executeUpdate('INSERT INTO sync_status (`key`, last_sync, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE last_sync=VALUES(last_sync), status=VALUES(status)', [key, Date.now(), status]);
      return { success: true };
    } catch (error) {
      const err = error as { code?: string; errno?: number };
      // If table doesn't exist, just log and continue (not critical)
      if (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146) {
        console.warn('⚠️ [SYNC STATUS] sync_status table does not exist - skipping status update');
        return { success: true }; // Return success to not break sync flow
      }
      console.error('Error updating sync status:', error);
      return { success: false };
    }
  });
  ipcMain.handle('localdb-get-sync-status', async (event, key: string) => {
    try {
      // 'key' is a reserved word in MySQL, need to escape it with backticks
      return await executeQueryOne('SELECT * FROM sync_status WHERE `key` = ?', [key]);
    } catch (error) {
      const err = error as { code?: string; errno?: number };
      // If table doesn't exist, just return null (not critical)
      if (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146) {
        console.warn('⚠️ [SYNC STATUS] sync_status table does not exist');
        return null;
      }
      console.error('Error getting sync status:', error);
      return null;
    }
  });

  // Comprehensive IPC handlers for all POS tables
  // Users
  ipcMain.handle('localdb-upsert-users', async (event, rows: RowArray, skipRoleValidation: boolean = false) => {
    try {
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];
      let skippedCount = 0;

      for (const r of rows) {
        const getId = () => {
          const val = r.id;
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getNumber = (key: string) => {
          const val = r[key];
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getString = (key: string) => (typeof r[key] === 'string' ? r[key] as string : null);
        const getDate = (key: string) => {
          const val = r[key];
          if (val instanceof Date) return val;
          if (typeof val === 'string' || typeof val === 'number') return val;
          return null;
        };

        const userId = getId(); let roleId = getNumber('role_id');
        let orgId = getNumber('organization_id');

        // Verify role_id exists before inserting (foreign key constraint) - SKIP on first pass to break circular dependency
        if (roleId && !skipRoleValidation) {
          try {
            const roleExists = await executeQueryOne<{ id: number }>('SELECT id FROM roles WHERE id = ? LIMIT 1', [roleId]); if (!roleExists) {
              console.warn(`⚠️ [USERS] Skipping user ${userId}: role_id ${roleId} does not exist`); skippedCount++;
              continue;
            }
          } catch (checkError) {
            console.warn(`⚠️ [USERS] Failed to verify role_id ${roleId}:`, checkError);
            skippedCount++;
            continue;
          }
        } else if (roleId && skipRoleValidation) {
          console.log(`ℹ️ [USERS] Skipping role validation for user ${userId} (first pass - breaking circular dependency)`);
        }

        // Verify organization_id exists before inserting (foreign key constraint) - SKIP on first pass
        if (orgId && !skipRoleValidation) {
          try {
            const orgExists = await executeQueryOne<{ id: number }>('SELECT id FROM organizations WHERE id = ? LIMIT 1', [orgId]);
            if (!orgExists) {
              console.warn(`⚠️ [USERS] Skipping user ${userId}: organization_id ${orgId} does not exist`);
              skippedCount++;
              continue;
            }
          } catch (checkError) {
            console.warn(`⚠️ [USERS] Failed to verify organization_id ${orgId}:`, checkError);
            skippedCount++;
            continue;
          }
        } else if (orgId && skipRoleValidation) {
          console.log(`ℹ️ [USERS] Skipping organization validation for user ${userId} (first pass - breaking circular dependency)`);
        }

        const createdAtRaw = getDate('createdAt');
        const createdAt = createdAtRaw ? toMySQLTimestamp(createdAtRaw as string | number | Date) : toMySQLTimestamp(new Date());

        queries.push({
          sql: `INSERT INTO users (
            id, email, password, name, googleId, createdAt, role_id, organization_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            email=VALUES(email), password=VALUES(password), name=VALUES(name),
            googleId=VALUES(googleId), createdAt=VALUES(createdAt), role_id=VALUES(role_id),
            organization_id=VALUES(organization_id)`,
          params: [
            userId,
            getString('email'),
            getString('password'),
            getString('name'),
            getString('googleId'),
            createdAt,
            roleId,
            orgId
          ]
        });
      }

      if (queries.length > 0) {
        if (skipRoleValidation) {
          // On first pass: Insert users one by one to handle foreign key errors individually
          let successCount = 0;
          let failCount = 0;
          for (const query of queries) {
            try {
              await executeUpdate(query.sql, query.params || []);
              successCount++;
            } catch (insertError: unknown) {
              const err = insertError as { code?: string; errno?: number; message?: string };
              if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.errno === 1452) {
                // Foreign key constraint - expected on first pass, will retry later
                failCount++; console.log(`ℹ️ [USERS] User ${query.params?.[0]} insert failed (foreign key - will retry later): ${err.message}`);
              } else {
                // Unexpected error - log and continue
                failCount++;
                console.warn(`⚠️ [USERS] User ${query.params?.[0]} insert failed: ${err.message}`);
              }
            }
          } console.log(`ℹ️ [USERS] First pass: ${successCount} inserted, ${failCount} failed (will retry later)`);
        } else {
          // On retry pass: Use transaction for better performance
          try {
            await executeTransaction(queries);
            await upsertMasterDataToSystemPos(queries);
            if (skippedCount > 0) {
              console.log(`⚠️ [USERS] Skipped ${skippedCount} users due to missing roles/organizations`);
            }
          } catch (transactionError: unknown) {
            const err = transactionError as { code?: string; errno?: number; message?: string }; console.error(`❌ [USERS] Transaction error:`, transactionError);
            throw transactionError;
          }
        }
      } else {
        console.warn(`⚠️ [USERS] No valid users to insert (all ${rows.length} skipped)`);
      }
      return { success: true };
    } catch (error) {
      console.error('Error upserting users:', error);
      return { success: false };
    }
  });

  ipcMain.handle('localdb-get-users', async () => {
    try {
      return await executeQuery('SELECT * FROM users ORDER BY name ASC');
    } catch (error) {
      console.error('Error getting users:', error);
      return [];
    }
  });

  // Businesses
  ipcMain.handle('localdb-upsert-businesses', async (event, rows: RowArray) => {
    try {
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];
      let skippedCount = 0;

      for (const r of rows) {
        const getId = () => {
          const val = r.id;
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getNumber = (key: string) => {
          const val = r[key];
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getString = (key: string) => (typeof r[key] === 'string' ? r[key] as string : null);
        const getDate = (key: string) => {
          const val = r[key];
          if (val instanceof Date) return val;
          if (typeof val === 'string' || typeof val === 'number') return val;
          return null;
        };

        const businessId = getId();
        let orgId = getNumber('organization_id');
        let mgmtGroupId = getNumber('management_group_id');

        // Verify organization_id exists before inserting (foreign key constraint)
        if (orgId) {
          try {
            const orgExists = await executeQueryOne<{ id: number }>('SELECT id FROM organizations WHERE id = ? LIMIT 1', [orgId]);
            if (!orgExists) {
              console.warn(`⚠️ [BUSINESSES] Skipping business ${businessId}: organization_id ${orgId} does not exist`);
              skippedCount++;
              continue;
            }
          } catch (checkError) {
            console.warn(`⚠️ [BUSINESSES] Failed to verify organization_id ${orgId}:`, checkError);
            skippedCount++;
            continue;
          }
        }

        // Skip management_group_id validation - not needed in POS app (CRM-only)
        // Just set to NULL if provided since we're not syncing management_groups table
        if (mgmtGroupId) {
          mgmtGroupId = null;
        }

        const status = getString('status') || 'active';
        const createdAtRaw = getDate('created_at');
        const createdAt = createdAtRaw ? toMySQLTimestamp(createdAtRaw as string | number | Date) : toMySQLTimestamp(new Date());

        queries.push({
          sql: `INSERT INTO businesses (
            id, name, permission_name, organization_id, status, management_group_id, image_url, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name=VALUES(name), permission_name=VALUES(permission_name), organization_id=VALUES(organization_id),
            status=VALUES(status), management_group_id=VALUES(management_group_id), image_url=VALUES(image_url),
            created_at=VALUES(created_at)`,
          params: [
            businessId,
            getString('name'),
            getString('permission_name'),
            orgId,
            status,
            mgmtGroupId,
            getString('image_url'),
            createdAt
          ]
        });
      }

      if (queries.length > 0) {
        await executeTransaction(queries);
        await upsertMasterDataToSystemPos(queries);
        if (skippedCount > 0) {
          console.log(`⚠️ [BUSINESSES] Skipped ${skippedCount} businesses due to missing organizations`);
        }
      } else {
        console.warn(`⚠️ [BUSINESSES] No valid businesses to insert (all ${rows.length} skipped)`);
      }
      return { success: true };
    } catch (error) {
      console.error('Error upserting businesses:', error);
      return { success: false };
    }
  });

  ipcMain.handle('localdb-get-businesses', async () => {
    try {
      return await executeQuery('SELECT * FROM businesses ORDER BY name ASC');
    } catch (error) {
      console.error('Error getting businesses:', error);
      return [];
    }
  });

  // Login logo: cache business logo for offline-first login screen
  const LOGIN_LOGO_PATH = () => path.join(app.getPath('userData'), 'login-logo.png');
  ipcMain.handle('cache-business-logo-for-login', async (_event, businessId: number, baseUrlFromRenderer?: string) => {
    try {
      const row = await executeQueryOne<{ id: number; image_url: string | null }>(
        'SELECT id, image_url FROM businesses WHERE id = ? LIMIT 1',
        [businessId]
      );
      const imageUrl = row?.image_url;
      if (!imageUrl || typeof imageUrl !== 'string') return { success: false };
      const userData = app.getPath('userData');
      const destPath = LOGIN_LOGO_PATH();
      if (imageUrl.startsWith('pos-image://')) {
        const rest = imageUrl.replace(/^pos-image:\/\//, '');
        const localPath = path.join(userData, rest);
        if (fs.existsSync(localPath)) {
          fs.copyFileSync(localPath, destPath);
          return { success: true };
        }
        return { success: false };
      }
      if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
        const res = await fetch(imageUrl);
        if (!res.ok) return { success: false };
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(destPath, buf);
        return { success: true };
      }
      // Relative path (e.g. /images/momoyo.png): fetch from API base URL or copy from userData
      if (imageUrl.startsWith('/')) {
        const baseUrl = (baseUrlFromRenderer ?? readConfig()?.apiUrl ?? process.env.NEXT_PUBLIC_API_URL ?? '') as string;
        if (baseUrl) {
          const base = (baseUrl as string).replace(/\/$/, '');
          const fullUrl = `${base}${imageUrl}`;
          try {
            const res = await fetch(fullUrl);
            if (res.ok) {
              const buf = Buffer.from(await res.arrayBuffer());
              fs.writeFileSync(destPath, buf);
              return { success: true };
            }
          } catch {
            // ignore; try local path below
          }
        }
        const localPath = path.join(userData, imageUrl.slice(1));
        if (fs.existsSync(localPath)) {
          fs.copyFileSync(localPath, destPath);
          return { success: true };
        }
      }
      return { success: false };
    } catch (err) {
      console.warn('cache-business-logo-for-login failed:', err);
      return { success: false };
    }
  });
  ipcMain.handle('get-login-logo', async () => {
    try {
      const p = LOGIN_LOGO_PATH();
      const fileExists = fs.existsSync(p);
      if (!fileExists) return { dataUrl: null };
      const buf = fs.readFileSync(p);
      const base64 = buf.toString('base64');
      const dataUrl = `data:image/png;base64,${base64}`;
      return { dataUrl };
    } catch {
      return { dataUrl: null };
    }
  });

  // Employees Position
  ipcMain.handle('localdb-upsert-employees-position', async (event, rows: RowArray) => {
    // #region agent log
    const logData = { location: 'main.ts:2067', message: 'localdb-upsert-employees-position called', data: { rowCount: Array.isArray(rows) ? rows.length : 0, firstRow: Array.isArray(rows) && rows.length > 0 ? rows[0] : null }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' };
    writeDebugLog(JSON.stringify(logData));
    // #endregion
    try {
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];

      for (const r of rows) {
        const getId = () => {
          const val = r.id;
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getString = (key: string) => (typeof r[key] === 'string' ? r[key] as string : null);
        const getDate = (key: string) => {
          const val = r[key];
          if (val instanceof Date) return val;
          if (typeof val === 'string' || typeof val === 'number') return val;
          return null;
        };

        const positionId = getId();
        const namaJabatan = getString('nama_jabatan');
        const createdAtRaw = getDate('created_at');
        const updatedAtRaw = getDate('updated_at');
        const createdAt = createdAtRaw ? toMySQLTimestamp(createdAtRaw as string | number | Date) : toMySQLTimestamp(new Date());
        const updatedAt = updatedAtRaw ? toMySQLTimestamp(updatedAtRaw as string | number | Date) : toMySQLTimestamp(new Date());

        queries.push({
          sql: `INSERT INTO employees_position (
            id, nama_jabatan, created_at, updated_at
          ) VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            nama_jabatan=VALUES(nama_jabatan), created_at=VALUES(created_at), updated_at=VALUES(updated_at)`,
          params: [positionId, namaJabatan, createdAt, updatedAt]
        });
      }

      // #region agent log
      const logBeforeExec = { location: 'main.ts:2107', message: 'Before executing employees_position queries', data: { queryCount: queries.length, firstQuery: queries.length > 0 ? { sql: queries[0].sql, paramCount: queries[0].params?.length || 0 } : null }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'E' };
      writeDebugLog(JSON.stringify(logBeforeExec));
      // #endregion
      if (queries.length > 0) {
        await executeTransaction(queries);
        // #region agent log
        const logAfterExec = { location: 'main.ts:2110', message: 'After executing employees_position queries', data: { success: true }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'E' };
        writeDebugLog(JSON.stringify(logAfterExec));
        // #endregion
        await upsertMasterDataToSystemPos(queries);
      }
      return { success: true };
    } catch (error) {
      // #region agent log
      const logError = { location: 'main.ts:2113', message: 'employees_position upsert error', data: { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' };
      writeDebugLog(JSON.stringify(logError));
      // #endregion
      console.error('Error upserting employees_position:', error);
      return { success: false };
    }
  });

  ipcMain.handle('localdb-get-employees-position', async () => {
    try {
      return await executeQuery('SELECT * FROM employees_position ORDER BY nama_jabatan ASC');
    } catch (error) {
      console.error('Error getting employees_position:', error);
      return [];
    }
  });

  // Employees
  ipcMain.handle('localdb-upsert-employees', async (event, rows: RowArray, skipValidation: boolean = false) => {
    // #region agent log
    const logEntry = { location: 'main.ts:2127', message: 'localdb-upsert-employees called', data: { rowCount: Array.isArray(rows) ? rows.length : 0, skipValidation: skipValidation, firstRow: Array.isArray(rows) && rows.length > 0 ? rows[0] : null }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' };
    writeDebugLog(JSON.stringify(logEntry));
    // #endregion
    try {
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];
      let skippedCount = 0;

      for (const r of rows) {
        const getId = () => {
          const val = r.id;
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getNumber = (key: string) => {
          const val = r[key];
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getString = (key: string) => (typeof r[key] === 'string' ? r[key] as string : null);
        const getDate = (key: string) => {
          const val = r[key];
          if (val instanceof Date) return val;
          if (typeof val === 'string' || typeof val === 'number') return val;
          return null;
        };

        const employeeId = getId();
        const userId = getNumber('user_id');
        const businessId = getNumber('business_id');
        const jabatanId = getNumber('jabatan_id');
        const noKtp = getString('no_ktp');
        const phone = getString('phone');
        const namaKaryawan = getString('nama_karyawan');
        const jenisKelamin = getString('jenis_kelamin');
        const alamat = getString('alamat');
        const tanggalLahirRaw = getDate('tanggal_lahir');
        const tanggalBekerjaRaw = getDate('tanggal_bekerja');
        const createdAtRaw = getDate('created_at');
        const updatedAtRaw = getDate('updated_at');
        const pin = getString('pin');
        const color = getString('color');

        // Convert dates to MySQL DATE format (YYYY-MM-DD)
        // Robust date conversion that handles various input formats
        const convertToMySQLDate = (date: Date | string | number | null | undefined): string | null => {
          if (!date) return null;

          // If already in YYYY-MM-DD format, return as-is
          if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return date;
          }

          // Try to parse as date
          let dateObj: Date;
          if (typeof date === 'number') {
            dateObj = new Date(date);
          } else if (typeof date === 'string') {
            // Handle ISO strings, MySQL datetime strings, etc.
            dateObj = new Date(date);
          } else {
            dateObj = date;
          }

          // Check if date is valid
          if (isNaN(dateObj.getTime())) {
            console.warn(`⚠️ [EMPLOYEES] Invalid date value: ${date}`);
            return null;
          }

          // Convert to UTC+7 (WIB) and extract date part
          const utc7Timestamp = dateObj.getTime() + (7 * 60 * 60 * 1000);
          const utc7Date = new Date(utc7Timestamp);

          const year = utc7Date.getUTCFullYear();
          const month = String(utc7Date.getUTCMonth() + 1).padStart(2, '0');
          const day = String(utc7Date.getUTCDate()).padStart(2, '0');

          return `${year}-${month}-${day}`;
        };
        const tanggalLahir = convertToMySQLDate(tanggalLahirRaw);
        const tanggalBekerja = convertToMySQLDate(tanggalBekerjaRaw);

        // Validate required fields
        if (!namaKaryawan) {
          // #region agent log
          writeDebugLog(JSON.stringify({ location: 'main.ts:2214', message: 'Skipping employee - missing nama_karyawan', data: { employeeId: employeeId }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'F' }));
          // #endregion
          console.warn(`⚠️ [EMPLOYEES] Skipping employee ${employeeId}: nama_karyawan is required`);
          skippedCount++;
          continue;
        }

        if (!jenisKelamin || !['pria', 'wanita'].includes(jenisKelamin)) {
          // #region agent log
          writeDebugLog(JSON.stringify({ location: 'main.ts:2220', message: 'Skipping employee - invalid jenis_kelamin', data: { employeeId: employeeId, jenisKelamin: jenisKelamin }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'F' }));
          // #endregion
          console.warn(`⚠️ [EMPLOYEES] Skipping employee ${employeeId}: invalid jenis_kelamin`);
          skippedCount++;
          continue;
        }

        if (!tanggalBekerja) {
          // #region agent log
          writeDebugLog(JSON.stringify({ location: 'main.ts:2226', message: 'Skipping employee - missing tanggal_bekerja', data: { employeeId: employeeId, tanggalBekerjaRaw: tanggalBekerjaRaw }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'F' }));
          // #endregion
          console.warn(`⚠️ [EMPLOYEES] Skipping employee ${employeeId}: tanggal_bekerja is required`);
          skippedCount++;
          continue;
        }
        const createdAt = createdAtRaw ? toMySQLTimestamp(createdAtRaw as string | number | Date) : toMySQLTimestamp(new Date());
        const updatedAt = updatedAtRaw ? toMySQLTimestamp(updatedAtRaw as string | number | Date) : toMySQLTimestamp(new Date());

        // Validate foreign keys if not skipping validation
        if (!skipValidation) {
          // Validate user_id exists if provided
          if (userId) {
            try {
              const userExists = await executeQueryOne<{ id: number }>('SELECT id FROM users WHERE id = ? LIMIT 1', [userId]);
              if (!userExists) {
                console.warn(`⚠️ [EMPLOYEES] Skipping employee ${employeeId}: user_id ${userId} does not exist`);
                skippedCount++;
                continue;
              }
            } catch (checkError) {
              console.warn(`⚠️ [EMPLOYEES] Failed to verify user_id ${userId}:`, checkError);
              skippedCount++;
              continue;
            }
          }

          // Validate business_id exists if provided
          if (businessId) {
            try {
              const businessExists = await executeQueryOne<{ id: number }>('SELECT id FROM businesses WHERE id = ? LIMIT 1', [businessId]);
              if (!businessExists) {
                console.warn(`⚠️ [EMPLOYEES] Skipping employee ${employeeId}: business_id ${businessId} does not exist`);
                skippedCount++;
                continue;
              }
            } catch (checkError) {
              console.warn(`⚠️ [EMPLOYEES] Failed to verify business_id ${businessId}:`, checkError);
              skippedCount++;
              continue;
            }
          }

          // Validate jabatan_id exists if provided
          if (jabatanId) {
            try {
              const jabatanExists = await executeQueryOne<{ id: number }>('SELECT id FROM employees_position WHERE id = ? LIMIT 1', [jabatanId]);
              if (!jabatanExists) {
                console.warn(`⚠️ [EMPLOYEES] Skipping employee ${employeeId}: jabatan_id ${jabatanId} does not exist`);
                skippedCount++;
                continue;
              }
            } catch (checkError) {
              console.warn(`⚠️ [EMPLOYEES] Failed to verify jabatan_id ${jabatanId}:`, checkError);
              skippedCount++;
              continue;
            }
          }
        }

        try {
          // #region agent log
          const logBuild = { location: 'main.ts:2314', message: 'Building employee query', data: { employeeId: employeeId, business_id: businessId, user_id: userId, namaKaryawan: namaKaryawan, tanggalLahir: tanggalLahir, tanggalBekerja: tanggalBekerja, jenisKelamin: jenisKelamin }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' };
          writeDebugLog(JSON.stringify(logBuild));
          // #endregion
          queries.push({
            sql: `INSERT INTO employees (
              id, user_id, business_id, jabatan_id, no_ktp, phone, nama_karyawan,
              jenis_kelamin, alamat, tanggal_lahir, tanggal_bekerja, pin, color, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              user_id=VALUES(user_id), business_id=VALUES(business_id), jabatan_id=VALUES(jabatan_id),
              no_ktp=VALUES(no_ktp), phone=VALUES(phone), nama_karyawan=VALUES(nama_karyawan),
              jenis_kelamin=VALUES(jenis_kelamin), alamat=VALUES(alamat), tanggal_lahir=VALUES(tanggal_lahir),
              tanggal_bekerja=VALUES(tanggal_bekerja), pin=VALUES(pin), color=VALUES(color), created_at=VALUES(created_at), updated_at=VALUES(updated_at)`,
            // no_ktp is NOT NULL and UNIQUE; use a unique placeholder when missing so sync doesn't fail
            params: [
              employeeId, userId, businessId, jabatanId, noKtp ?? (employeeId != null ? `__no_ktp_${employeeId}` : ''), phone || null, namaKaryawan,
              jenisKelamin, alamat || null, tanggalLahir, tanggalBekerja, pin || null, color || null, createdAt, updatedAt
            ]
          });
        } catch (queryError) {
          // #region agent log
          const logError = { location: 'main.ts:2332', message: 'Error building employee query', data: { employeeId: employeeId, error: queryError instanceof Error ? queryError.message : String(queryError) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'G' };
          writeDebugLog(JSON.stringify(logError));
          // #endregion
          console.error(`❌ [EMPLOYEES] Error building query for employee ${employeeId}:`, queryError);
          skippedCount++;
          continue;
        }
      }

      // #region agent log
      writeDebugLog(JSON.stringify({ location: 'main.ts:2343', message: 'Before executing employee queries', data: { queryCount: queries.length, skipValidation: skipValidation, skippedCount: skippedCount }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'E' }));
      // #endregion
      if (queries.length > 0) {
        if (skipValidation) {
          // On first pass: Insert employees one by one to handle foreign key errors individually
          let successCount = 0;
          let failCount = 0;
          for (const query of queries) {
            try {
              await executeUpdate(query.sql, query.params || []);
              successCount++;
              // #region agent log
              writeDebugLog(JSON.stringify({ location: 'main.ts:2351', message: 'Employee upsert success', data: { employeeId: query.params?.[0], business_id: query.params?.[2], user_id: query.params?.[1], nama_karyawan: query.params?.[6] }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }));
              // #endregion
            } catch (insertError: unknown) {
              const err = insertError as { code?: string; errno?: number; message?: string };
              // #region agent log
              writeDebugLog(JSON.stringify({ location: 'main.ts:2353', message: 'Employee insert failed', data: { employeeId: query.params?.[0], error: err.message, code: err.code, errno: err.errno, isForeignKey: err.code === 'ER_NO_REFERENCED_ROW_2' || err.errno === 1452 }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'E' }));
              // #endregion
              if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.errno === 1452) {
                // Foreign key constraint - expected on first pass, will retry later
                failCount++;
                console.log(`ℹ️ [EMPLOYEES] Employee ${query.params?.[0]} insert failed (foreign key - will retry later): ${err.message}`);
              } else {
                // Unexpected error - log and continue
                failCount++;
                console.error(`❌ [EMPLOYEES] Employee ${query.params?.[0]} insert failed: ${err.message}`);
                console.error(`❌ [EMPLOYEES] Error code: ${err.code}, errno: ${err.errno}`);
              }
            }
          }
          // #region agent log
          writeDebugLog(JSON.stringify({ location: 'main.ts:2366', message: 'First pass summary', data: { successCount: successCount, failCount: failCount, skippedCount: skippedCount }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'E' }));
          // #endregion
          console.log(`ℹ️ [EMPLOYEES] First pass: ${successCount} inserted, ${failCount} failed (will retry later)`);
          if (skippedCount > 0) {
            console.log(`⚠️ [EMPLOYEES] Skipped ${skippedCount} employees due to validation errors`);
          }
        } else {
          // On retry pass: Use transaction for better performance
          try {
            // #region agent log
            const employeesBeingUpserted = queries.map(q => ({ id: q.params?.[0], business_id: q.params?.[2], user_id: q.params?.[1], nama_karyawan: q.params?.[6] }));
            writeDebugLog(JSON.stringify({ location: 'main.ts:2633', message: 'About to upsert employees in transaction', data: { queryCount: queries.length, employees: employeesBeingUpserted }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
            // #endregion
            await executeTransaction(queries);
            await upsertMasterDataToSystemPos(queries);
            // #region agent log
            writeDebugLog(JSON.stringify({ location: 'main.ts:2374', message: 'Employee transaction success', data: { queryCount: queries.length, employees: employeesBeingUpserted }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
            // #endregion
            if (skippedCount > 0) {
              console.log(`⚠️ [EMPLOYEES] Skipped ${skippedCount} employees due to missing foreign keys`);
            }
          } catch (transactionError: unknown) {
            const err = transactionError as { code?: string; errno?: number; message?: string };
            // #region agent log
            writeDebugLog(JSON.stringify({ location: 'main.ts:2378', message: 'Employee transaction error', data: { error: err.message, code: err.code, errno: err.errno }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'E' }));
            // #endregion
            console.error(`❌ [EMPLOYEES] Transaction error:`, transactionError);
            throw transactionError;
          }
        }
      } else {
        // #region agent log
        writeDebugLog(JSON.stringify({ location: 'main.ts:2383', message: 'No employee queries to execute', data: { rowCount: rows.length, skippedCount: skippedCount }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'F' }));
        // #endregion
        console.warn(`⚠️ [EMPLOYEES] No valid employees to insert (all ${rows.length} skipped)`);
      }

      if (skippedCount > 0 && !skipValidation) {
        console.warn(`⚠️ [EMPLOYEES] Total skipped: ${skippedCount} employees`);
      }

      return { success: true, skipped: skippedCount };
    } catch (error) {
      console.error('❌ [EMPLOYEES] Error upserting employees:', error);
      if (error instanceof Error) {
        console.error('❌ [EMPLOYEES] Error message:', error.message);
        console.error('❌ [EMPLOYEES] Error stack:', error.stack);
      }
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('localdb-get-employees', async () => {
    try {
      // #region agent log
      const logBefore = { location: 'main.ts:2425', message: 'localdb-get-employees called', data: {}, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' };
      writeDebugLog(JSON.stringify(logBefore));
      // #endregion
      const result = await executeQuery('SELECT * FROM employees ORDER BY nama_karyawan ASC');
      // #region agent log
      const logAfter = { location: 'main.ts:2427', message: 'localdb-get-employees result', data: { resultCount: Array.isArray(result) ? result.length : 0, result: Array.isArray(result) ? result.map((e: any) => ({ id: e.id, business_id: e.business_id, jabatan_id: e.jabatan_id, nama: e.nama_karyawan })) : null }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' };
      writeDebugLog(JSON.stringify(logAfter));
      // #endregion
      return result;
    } catch (error) {
      // #region agent log
      const logError = { location: 'main.ts:2430', message: 'localdb-get-employees error', data: { error: error instanceof Error ? error.message : String(error) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' };
      writeDebugLog(JSON.stringify(logError));
      // #endregion
      console.error('Error getting employees:', error);
      return [];
    }
  });

  ipcMain.handle('localdb-cleanup-orphaned-employees', async (_event, businessId: number, syncedEmployeeIds: number[]) => {
    try {
      if (!Array.isArray(syncedEmployeeIds) || syncedEmployeeIds.length === 0) {
        return { success: true, deletedCount: 0, deletedEmployeeIds: [] };
      }
      const placeholders = syncedEmployeeIds.map(() => '?').join(',');
      const orphaned = await executeQuery<{ id: number }>(
        `SELECT id FROM employees WHERE business_id = ? AND id NOT IN (${placeholders})`,
        [businessId, ...syncedEmployeeIds]
      );
      if (!Array.isArray(orphaned) || orphaned.length === 0) {
        return { success: true, deletedCount: 0, deletedEmployeeIds: [] };
      }
      const ids = orphaned.map((e) => e.id);
      const delPlaceholders = ids.map(() => '?').join(',');
      await executeUpdate(`DELETE FROM employees WHERE id IN (${delPlaceholders})`, ids);
      return { success: true, deletedCount: ids.length, deletedEmployeeIds: ids };
    } catch (err) {
      console.warn('localdb-cleanup-orphaned-employees failed:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err), deletedCount: 0, deletedEmployeeIds: [] };
    }
  });

  // Ingredients
  ipcMain.handle('localdb-upsert-ingredients', async (event, rows: RowArray) => {
    try {
      const queries = rows.map(r => {
        const getId = () => {
          const val = r.id;
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getString = (key: string) => (typeof r[key] === 'string' ? r[key] as string : null);
        const getNumber = (key: string) => {
          const val = r[key];
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getDate = (key: string) => {
          const val = r[key];
          if (val instanceof Date) return val;
          if (typeof val === 'string' || typeof val === 'number') return val;
          return null;
        };
        const createdAtRaw = getDate('created_at');
        const createdAt = createdAtRaw ? toMySQLTimestamp(createdAtRaw as string | number | Date) : toMySQLTimestamp(new Date());
        return {
          sql: `INSERT INTO ingredients (
            id, ingredient_code, nama, kategori, satuan_beli, isi_satuan_beli, satuan_keluar,
            harga_beli, stok_min, status, business_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            ingredient_code=VALUES(ingredient_code), nama=VALUES(nama), kategori=VALUES(kategori),
            satuan_beli=VALUES(satuan_beli), isi_satuan_beli=VALUES(isi_satuan_beli), satuan_keluar=VALUES(satuan_keluar),
            harga_beli=VALUES(harga_beli), stok_min=VALUES(stok_min), status=VALUES(status),
            business_id=VALUES(business_id), created_at=VALUES(created_at), updated_at=VALUES(updated_at)`,
          params: [
            getId(), getString('ingredient_code'), getString('nama'), getString('kategori'),
            getString('satuan_beli'), getNumber('isi_satuan_beli'), getString('satuan_keluar'),
            getNumber('harga_beli'), getNumber('stok_min'), getString('status'), getNumber('business_id'),
            createdAt, toMySQLTimestamp(Date.now())
          ]
        };
      });
      await executeTransaction(queries);
      return { success: true };
    } catch (error) {
      console.error('Error upserting ingredients:', error);
      return { success: false };
    }
  });

  ipcMain.handle('localdb-get-ingredients', async (event, businessId?: number) => {
    try {
      if (businessId) {
        return await executeQuery('SELECT * FROM ingredients WHERE business_id = ? AND status = \'active\' ORDER BY nama ASC', [businessId]);
      } else {
        return await executeQuery('SELECT * FROM ingredients WHERE status = \'active\' ORDER BY nama ASC');
      }
    } catch (error) {
      console.error('Error getting ingredients:', error);
      return [];
    }
  });

  // COGS
  ipcMain.handle('localdb-upsert-cogs', async (event, rows: RowArray) => {
    try {
      const queries = rows.map(r => {
        const getId = () => {
          const val = r.id;
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getString = (key: string) => (typeof r[key] === 'string' ? r[key] as string : null);
        const getNumber = (key: string) => {
          const val = r[key];
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getDate = (key: string) => {
          const val = r[key];
          if (val instanceof Date) return val;
          if (typeof val === 'string' || typeof val === 'number') return val;
          return null;
        };
        const createdAtRaw = getDate('created_at');
        const createdAt = createdAtRaw ? toMySQLTimestamp(createdAtRaw as string | number | Date) : toMySQLTimestamp(new Date());
        return {
          sql: `INSERT INTO cogs (
            id, menu_code, ingredient_code, amount, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            menu_code=VALUES(menu_code), ingredient_code=VALUES(ingredient_code),
            amount=VALUES(amount), created_at=VALUES(created_at), updated_at=VALUES(updated_at)`,
          params: [
            getId(),
            getString('menu_code'),
            getString('ingredient_code'),
            getNumber('amount'),
            createdAt,
            toMySQLTimestamp(Date.now())
          ]
        };
      });
      await executeTransaction(queries);
      return { success: true };
    } catch (error) {
      console.error('Error upserting COGS:', error);
      return { success: false };
    }
  });

  ipcMain.handle('localdb-get-cogs', async () => {
    try {
      return await executeQuery('SELECT * FROM cogs ORDER BY menu_code ASC');
    } catch (error) {
      console.error('Error getting COGS:', error);
      return [];
    }
  });

  // Contacts
  ipcMain.handle('localdb-upsert-contacts', async (event, rows: RowArray) => {
    try {
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];

      for (const r of rows) {
        const getId = () => {
          const val = r.id;
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getString = (key: string) => (typeof r[key] === 'string' ? r[key] as string : null);
        const getNumber = (key: string) => {
          const val = r[key];
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getBoolean = (key: string) => {
          const val = r[key];
          if (typeof val === 'boolean') return val;
          if (typeof val === 'number') return val === 1;
          if (typeof val === 'string') return val === 'true' || val === '1';
          return null;
        };
        const getDate = (key: string) => {
          const val = r[key];
          if (val instanceof Date) return val;
          if (typeof val === 'string' || typeof val === 'number') return val;
          return null;
        };

        let sourceId = getNumber('source_id');

        // Verify source_id exists before inserting (foreign key constraint)
        if (sourceId) {
          try {
            const sourceExists = await executeQueryOne<{ id: number }>('SELECT id FROM source WHERE id = ? LIMIT 1', [sourceId]);
            if (!sourceExists) {
              console.warn(`⚠️ [CONTACTS] source_id ${sourceId} does not exist, setting to NULL`);
              sourceId = null;
            }
          } catch (checkError) {
            console.warn(`⚠️ [CONTACTS] Failed to verify source_id ${sourceId}:`, checkError);
            sourceId = null;
          }
        }

        const createdAtRaw = getDate('created_at');
        const createdAt = createdAtRaw ? toMySQLTimestamp(createdAtRaw as string | number | Date) : toMySQLTimestamp(new Date());

        queries.push({
          sql: `INSERT INTO contacts (
            id, no_ktp, nama, phone_number, tgl_lahir, no_kk, created_at, updated_at,
            is_active, jenis_kelamin, kota, kecamatan, source_id, pekerjaan_id,
            source_lainnya, alamat, team_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            no_ktp=VALUES(no_ktp), nama=VALUES(nama), phone_number=VALUES(phone_number),
            tgl_lahir=VALUES(tgl_lahir), no_kk=VALUES(no_kk), created_at=VALUES(created_at),
            updated_at=VALUES(updated_at), is_active=VALUES(is_active), jenis_kelamin=VALUES(jenis_kelamin),
            kota=VALUES(kota), kecamatan=VALUES(kecamatan), source_id=VALUES(source_id),
            pekerjaan_id=VALUES(pekerjaan_id), source_lainnya=VALUES(source_lainnya),
            alamat=VALUES(alamat), team_id=VALUES(team_id)`,
          params: [
            getId(), getString('no_ktp'), getString('nama'), getString('phone_number'),
            getString('tgl_lahir'), getString('no_kk'), createdAt, toMySQLTimestamp(Date.now()),
            getBoolean('is_active'), getString('jenis_kelamin'), getString('kota'), getString('kecamatan'),
            sourceId, getNumber('pekerjaan_id'),
            getString('source_lainnya'), getString('alamat'), getNumber('team_id')
          ]
        });
      }

      if (queries.length > 0) {
        await executeTransaction(queries);
      }
      return { success: true };
    } catch (error) {
      console.error('Error upserting contacts:', error);
      return { success: false };
    }
  });

  ipcMain.handle('localdb-get-contacts', async (event, teamId?: number) => {
    try {
      if (teamId) {
        return await executeQuery('SELECT * FROM contacts WHERE team_id = ? AND is_active = 1 ORDER BY nama ASC', [teamId]);
      } else {
        return await executeQuery('SELECT * FROM contacts WHERE is_active = 1 ORDER BY nama ASC');
      }
    } catch (error) {
      console.error('Error getting contacts:', error);
      return [];
    }
  });

  // Teams (duplicate handler - already migrated above, removing this duplicate)
  // This handler was already migrated earlier in the file

  // Roles
  ipcMain.handle('localdb-upsert-roles', async (event, rows: RowArray) => {
    try {
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];
      let skippedCount = 0;

      for (const r of rows) {
        const getId = () => {
          const val = r.id;
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getString = (key: string) => (typeof r[key] === 'string' ? r[key] as string : null);
        const getNumber = (key: string) => {
          const val = r[key];
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getDate = (key: string) => {
          const val = r[key];
          if (val instanceof Date) return val;
          if (typeof val === 'string' || typeof val === 'number') return val;
          return null;
        };

        const roleId = getId();
        let orgId = getNumber('organization_id');

        // Verify organization_id exists before inserting (foreign key constraint)
        if (orgId) {
          try {
            const orgExists = await executeQueryOne<{ id: number }>('SELECT id FROM organizations WHERE id = ? LIMIT 1', [orgId]);
            if (!orgExists) {
              console.warn(`⚠️ [ROLES] Skipping role ${roleId}: organization_id ${orgId} does not exist`);
              skippedCount++;
              continue;
            }
          } catch (checkError) {
            console.warn(`⚠️ [ROLES] Failed to verify organization_id ${orgId}:`, checkError);
            skippedCount++;
            continue;
          }
        }

        const createdAtRaw = getDate('created_at');
        const createdAt = createdAtRaw ? toMySQLTimestamp(createdAtRaw as string | number | Date) : toMySQLTimestamp(new Date());

        queries.push({
          sql: `INSERT INTO roles (
            id, name, description, organization_id, created_at
          ) VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name=VALUES(name),
            description=VALUES(description),
            organization_id=VALUES(organization_id),
            created_at=VALUES(created_at)`,
          params: [
            roleId,
            getString('name'),
            getString('description'),
            orgId,
            createdAt
          ]
        });
      }

      if (queries.length > 0) {
        await executeTransaction(queries);
        await upsertMasterDataToSystemPos(queries);
        if (skippedCount > 0) {
          console.log(`⚠️ [ROLES] Skipped ${skippedCount} roles due to missing organizations`);
        }
      } else {
        console.warn(`⚠️ [ROLES] No valid roles to insert (all ${rows.length} skipped)`);
      }
      return { success: true };
    } catch (error) {
      console.error('Error upserting roles:', error);
      return { success: false };
    }
  });

  ipcMain.handle('localdb-get-roles', async () => {
    try {
      return await executeQuery('SELECT * FROM roles ORDER BY name ASC');
    } catch (error) {
      console.error('Error getting roles:', error);
      return [];
    }
  });

  // Permission Categories
  ipcMain.handle('localdb-upsert-permission-categories', async (event, rows: RowArray) => {
    try {
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];
      let skippedCount = 0;

      for (const r of rows) {
        const getId = () => {
          const val = r.id;
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getString = (key: string) => (typeof r[key] === 'string' ? r[key] as string : null);
        const getNumber = (key: string) => {
          const val = r[key];
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getDate = (key: string) => {
          const val = r[key];
          if (val instanceof Date) return val;
          if (typeof val === 'string' || typeof val === 'number') return val;
          return null;
        };

        let orgId = getNumber('organization_id');

        // Verify organization_id exists if provided
        if (orgId) {
          try {
            const orgExists = await executeQueryOne<{ id: number }>('SELECT id FROM organizations WHERE id = ? LIMIT 1', [orgId]);
            if (!orgExists) {
              console.warn(`⚠️ [PERMISSION CATEGORIES] organization_id ${orgId} does not exist, setting to NULL`);
              orgId = null;
            }
          } catch (checkError) {
            console.warn(`⚠️ [PERMISSION CATEGORIES] Failed to verify organization_id ${orgId}:`, checkError);
            orgId = null;
          }
        }

        const createdAtRaw = getDate('created_at');
        const createdAt = createdAtRaw ? toMySQLTimestamp(createdAtRaw as string | number | Date) : toMySQLTimestamp(new Date());

        queries.push({
          sql: `INSERT INTO permission_categories (
            id, name, description, organization_id, created_at
          ) VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name=VALUES(name),
            description=VALUES(description),
            organization_id=VALUES(organization_id),
            created_at=VALUES(created_at)`,
          params: [
            getId(),
            getString('name'),
            getString('description'),
            orgId,
            createdAt
          ]
        });
      }

      if (queries.length > 0) {
        await executeTransaction(queries);
        if (skippedCount > 0) {
          console.log(`⚠️ [PERMISSION CATEGORIES] Skipped ${skippedCount} categories`);
        }
      }
      return { success: true };
    } catch (error) {
      console.error('Error upserting permission categories:', error);
      return { success: false };
    }
  });

  // Permissions
  ipcMain.handle('localdb-upsert-permissions', async (event, rows: RowArray) => {
    try {
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];
      let skippedCount = 0;

      for (const r of rows) {
        let categoryId = typeof r.category_id === 'number' ? r.category_id : null;
        let orgId = typeof r.organization_id === 'number' ? r.organization_id : null;
        let businessId = typeof r.business_id === 'number' ? r.business_id : null;

        // Verify category_id exists if provided (foreign key constraint)
        // Only check if permission_categories table exists
        if (categoryId) {
          try {
            // First check if table exists
            const tableExists = await executeQueryOne<{ count: number }>(
              `SELECT COUNT(*) as count FROM information_schema.tables 
               WHERE table_schema = DATABASE() AND table_name = 'permission_categories'`
            );

            if (tableExists && tableExists.count > 0) {
              const catExists = await executeQueryOne<{ id: number }>('SELECT id FROM permission_categories WHERE id = ? LIMIT 1', [categoryId]);
              if (!catExists) {
                console.warn(`⚠️ [PERMISSIONS] category_id ${categoryId} does not exist, setting to NULL`);
                categoryId = null;
              }
            } else {
              // Table doesn't exist, skip validation
              console.log(`ℹ️ [PERMISSIONS] permission_categories table does not exist, skipping category_id validation`);
            }
          } catch (checkError) {
            // If error is "table doesn't exist", that's okay - just skip validation
            if (checkError instanceof Error && checkError.message.includes("doesn't exist")) {
              console.log(`ℹ️ [PERMISSIONS] permission_categories table does not exist, skipping category_id validation`);
            } else {
              console.warn(`⚠️ [PERMISSIONS] Failed to verify category_id ${r.category_id}:`, checkError);
            }
            // Don't set categoryId to null if table doesn't exist - keep the original value
          }
        }

        // Verify organization_id exists if provided
        if (orgId) {
          try {
            const orgExists = await executeQueryOne<{ id: number }>('SELECT id FROM organizations WHERE id = ? LIMIT 1', [orgId]);
            if (!orgExists) {
              console.warn(`⚠️ [PERMISSIONS] organization_id ${orgId} does not exist, setting to NULL`);
              orgId = null;
            }
          } catch (checkError) {
            console.warn(`⚠️ [PERMISSIONS] Failed to verify organization_id ${orgId}:`, checkError);
            orgId = null;
          }
        }

        // Verify business_id exists if provided
        if (businessId) {
          try {
            const businessExists = await executeQueryOne<{ id: number }>('SELECT id FROM businesses WHERE id = ? LIMIT 1', [businessId]);
            if (!businessExists) {
              console.warn(`⚠️ [PERMISSIONS] business_id ${businessId} does not exist, setting to NULL`);
              businessId = null;
            }
          } catch (checkError) {
            console.warn(`⚠️ [PERMISSIONS] Failed to verify business_id ${businessId}:`, checkError);
            businessId = null;
          }
        }

        const id = typeof r.id === 'number' ? r.id : (typeof r.id === 'string' ? parseInt(String(r.id), 10) : 0);
        const name = typeof r.name === 'string' ? r.name : String(r.name ?? '');
        const description = typeof r.description === 'string' ? r.description : String(r.description ?? '');
        const status = typeof r.status === 'string' ? r.status : 'active';
        const createdAt = r.created_at ? (typeof r.created_at === 'number' || typeof r.created_at === 'string' ? r.created_at : new Date()) : new Date();

        queries.push({
          sql: `INSERT INTO permissions (
            id, name, description, category_id, organization_id, business_id, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name=VALUES(name),
            description=VALUES(description),
            category_id=VALUES(category_id),
            organization_id=VALUES(organization_id),
            business_id=VALUES(business_id),
            status=VALUES(status),
            created_at=VALUES(created_at)`,
          params: [
            id,
            name,
            description,
            categoryId ?? null,
            orgId ?? null,
            businessId ?? null,
            status,
            toMySQLTimestamp(createdAt)
          ]
        });
      }

      if (queries.length > 0) {
        await executeTransaction(queries);
        if (skippedCount > 0) {
          console.log(`⚠️ [PERMISSIONS] Skipped ${skippedCount} permissions`);
        }
      }
      return { success: true };
    } catch (error) {
      console.error('Error upserting permissions:', error);
      return { success: false };
    }
  });

  // Permissions (duplicate handler - already migrated above, removing this duplicate)
  // This handler was already migrated earlier in the file

  // Role permissions
  ipcMain.handle('localdb-upsert-role-permissions', async (event, rows: RowArray) => {
    try {
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];
      let skippedCount = 0;

      // Delete all existing role permissions first
      queries.push({
        sql: 'DELETE FROM role_permissions',
        params: []
      });

      // Then insert new ones (only if both role_id and permission_id exist)
      for (const r of rows ?? []) {
        const roleId = typeof r.role_id === 'number' ? r.role_id : (typeof r.role_id === 'string' ? parseInt(String(r.role_id), 10) : null);
        const permissionId = typeof r.permission_id === 'number' ? r.permission_id : (typeof r.permission_id === 'string' ? parseInt(String(r.permission_id), 10) : null);

        // Verify both role_id and permission_id exist
        if (roleId && permissionId) {
          try {
            const roleExists = await executeQueryOne<{ id: number }>('SELECT id FROM roles WHERE id = ? LIMIT 1', [roleId]);
            const permissionExists = await executeQueryOne<{ id: number }>('SELECT id FROM permissions WHERE id = ? LIMIT 1', [permissionId]);

            if (!roleExists) {
              console.warn(`⚠️ [ROLE PERMISSIONS] Skipping: role_id ${roleId} does not exist`);
              skippedCount++;
              continue;
            }

            if (!permissionExists) {
              console.warn(`⚠️ [ROLE PERMISSIONS] Skipping: permission_id ${permissionId} does not exist`);
              skippedCount++;
              continue;
            }

            queries.push({
              sql: `INSERT INTO role_permissions (
                role_id, permission_id
              ) VALUES (?, ?)
              ON DUPLICATE KEY UPDATE role_id=VALUES(role_id), permission_id=VALUES(permission_id)`,
              params: [roleId, permissionId]
            });
          } catch (checkError) {
            console.warn(`⚠️ [ROLE PERMISSIONS] Error checking role_id ${roleId} or permission_id ${permissionId}:`, checkError);
            skippedCount++;
            continue;
          }
        } else {
          console.warn(`⚠️ [ROLE PERMISSIONS] Skipping: missing role_id or permission_id`);
          skippedCount++;
        }
      }

      if (queries.length > 1) { // More than just DELETE
        await executeTransaction(queries);
        if (skippedCount > 0) {
          console.log(`⚠️ [ROLE PERMISSIONS] Skipped ${skippedCount} role-permission mappings due to missing roles/permissions`);
        }
      } else {
        console.warn(`⚠️ [ROLE PERMISSIONS] No valid role-permission mappings to insert (all ${rows.length} skipped)`);
      }
      return { success: true };
    } catch (error) {
      console.error('Error upserting role permissions:', error);
      return { success: false };
    }
  });

  ipcMain.handle('localdb-get-role-permissions', async (event, roleId: number) => {
    try {
      return await executeQuery(`
        SELECT p.id, p.name, p.status
        FROM role_permissions rp
        INNER JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = ?
        ORDER BY p.name ASC
      `, [roleId]);
    } catch (error) {
      console.error('Error getting role permissions:', error);
      return [];
    }
  });

  // Aggregated auth helper
  type User = {
    id: number;
    email: string;
    password: string | null;
    name: string | null;
    role_id: number | null;
    organization_id: number | null;
  };

  ipcMain.handle('localdb-get-user-auth', async (event, email: string) => {
    try {
      const user = await executeQueryOne<User>(`
        SELECT id, email, password, name, role_id, organization_id
        FROM users
        WHERE LOWER(email) = LOWER(?)
        LIMIT 1
      `, [email]);

      if (!user) {
        return null;
      }

      let roleName: string | null = null;
      if (user.role_id !== null && user.role_id !== undefined) {
        const role = await executeQueryOne<{ name?: string }>('SELECT name FROM roles WHERE id = ? LIMIT 1', [user.role_id]);
        roleName = role?.name ?? null;
      }

      const permissionRows = (user.role_id !== null && user.role_id !== undefined)
        ? await executeQuery<{ name: string }>(`
            SELECT p.name
            FROM role_permissions rp
            INNER JOIN permissions p ON p.id = rp.permission_id
            WHERE rp.role_id = ?
            ORDER BY p.name ASC
          `, [user.role_id])
        : [];

      return {
        ...user,
        role_name: roleName,
        permissions: Array.isArray(permissionRows) ? permissionRows.map((row) => row.name) : [],
      };
    } catch (error) {
      console.error('Error getting user auth:', error);
      return null;
    }
  });

  // Supporting tables
  ipcMain.handle('localdb-upsert-source', async (event, rows: RowArray) => {
    try {
      const queries = rows.map(r => {
        const id = typeof r.id === 'number' ? r.id : (typeof r.id === 'string' ? parseInt(String(r.id), 10) : 0);
        const sourceName = typeof r.source_name === 'string' ? r.source_name : String(r.source_name ?? '');
        const createdAt = r.created_at ? (typeof r.created_at === 'number' || typeof r.created_at === 'string' ? r.created_at : new Date()) : new Date();
        return {
          sql: `INSERT INTO source (id, source_name, created_at) 
            VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE
            source_name=VALUES(source_name), created_at=VALUES(created_at)`,
          params: [id, sourceName, toMySQLTimestamp(createdAt)]
        };
      });
      await executeTransaction(queries);
      return { success: true };
    } catch (error) {
      console.error('Error upserting source:', error);
      return { success: false };
    }
  });

  ipcMain.handle('localdb-get-source', async () => {
    try {
      return await executeQuery('SELECT * FROM source ORDER BY source_name ASC');
    } catch (error) {
      console.error('Error getting source:', error);
      return [];
    }
  });

  // Activity logs (split bill, pindah meja, etc.)
  ipcMain.handle('localdb-upsert-activity-logs', async (event, rows: RowArray) => {
    try {
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];
      for (const r of rows) {
        const userId = typeof r.user_id === 'number' ? r.user_id : (typeof r.user_id === 'string' ? parseInt(String(r.user_id), 10) : 0);
        const action = typeof r.action === 'string' ? r.action : String(r.action ?? '');
        const businessId = r.business_id != null ? (typeof r.business_id === 'number' ? r.business_id : parseInt(String(r.business_id), 10)) : null;
        const details = r.details != null ? String(r.details) : null;
        const createdAt = r.created_at ? toMySQLTimestamp(r.created_at as string | number | Date) : toMySQLTimestamp(new Date());
        queries.push({
          sql: `INSERT INTO activity_logs (user_id, action, business_id, details, created_at)
                VALUES (?, ?, ?, ?, ?)`,
          params: [userId, action, businessId, details, createdAt]
        });
      }
      if (queries.length > 0) {
        await executeTransaction(queries);
      }
      return { success: true };
    } catch (error) {
      console.error('Error upserting activity logs:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('localdb-get-activity-logs', async (event, businessId?: number) => {
    try {
      if (businessId != null) {
        return await executeQuery(
          'SELECT * FROM activity_logs WHERE business_id = ? ORDER BY created_at DESC',
          [businessId]
        );
      }
      return await executeQuery('SELECT * FROM activity_logs ORDER BY created_at DESC');
    } catch (error) {
      console.error('Error getting activity logs:', error);
      return [];
    }
  });

  // Skip pekerjaan IPC handlers - not needed in POS app (CRM-only)

  // New table handlers for enhanced offline support

  // Transactions
  ipcMain.handle('localdb-upsert-transactions', async (event, rows: RowArray) => {
    try {
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];

      for (const r of rows) {
        // Auto-link to active shift if shift_uuid is missing (use business_id only, not user_id)
        let finalShiftUuid = r.shift_uuid;
        if (!finalShiftUuid && r.business_id) {
          try {
            const businessId = typeof r.business_id === 'number' ? r.business_id : (r.business_id ? parseInt(String(r.business_id), 10) : null);
            if (businessId) {
              const activeShift = await executeQueryOne<{ uuid_id: string }>(`
                SELECT uuid_id 
                FROM shifts 
                WHERE business_id = ? AND status = 'active'
                ORDER BY shift_start ASC 
                LIMIT 1
              `, [businessId]);
              if (activeShift) {
                finalShiftUuid = activeShift.uuid_id;
                console.log(`🔗 [UPSERT] Linked transaction ${r.id} to active shift ${finalShiftUuid}`);
              }
            } else {
              console.warn('⚠️ [UPSERT] Skipping shift link - business_id is missing or invalid');
            }
          } catch (e) {
            console.warn('Failed to link transaction to active shift during upsert:', e);
          }
        }

        console.log('🔍 [MYSQL] Inserting transaction data:', {
          id: r.id,
          business_id: r.business_id,
          user_id: r.user_id,
          shift_uuid: finalShiftUuid,
          payment_method: r.payment_method,
          pickup_method: r.pickup_method,
          total_amount: r.total_amount,
          voucher_discount: r.voucher_discount,
          voucher_type: r.voucher_type,
          voucher_value: r.voucher_value,
          voucher_label: r.voucher_label,
          final_amount: r.final_amount,
          amount_received: r.amount_received,
          change_amount: r.change_amount,
          status: r.status,
          created_at: r.created_at,
          contact_id: r.contact_id,
          customer_name: r.customer_name,
          customer_unit: r.customer_unit,
          note: r.note,
          bank_name: r.bank_name,
          card_number: r.card_number,
          cl_account_id: r.cl_account_id,
          cl_account_name: r.cl_account_name,
          bank_id: r.bank_id,
          receipt_number: r.receipt_number,
          transaction_type: r.transaction_type,
          payment_method_id: r.payment_method_id,
          table_id: r.table_id
        });

        const getString = (key: string) => (typeof r[key] === 'string' ? r[key] as string : null);
        const getNumber = (key: string) => {
          const val = r[key];
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getDate = (key: string) => {
          const val = r[key];
          if (val instanceof Date) return val;
          if (typeof val === 'string' || typeof val === 'number') return val;
          return null;
        };
        const getStatus = () => {
          const status = typeof r.status === 'string' ? r.status : null;
          // Preserve 'pending' status, convert 'paid' to 'completed', default to 'completed'
          return status === 'pending' ? 'pending' : ((status === 'paid' || status === 'completed') ? 'completed' : (status ?? 'completed'));
        };
        const createdDate = getDate('created_at');
        const createdAt = createdDate ? toMySQLDateTime(createdDate as string | number | Date) : toMySQLDateTime(new Date());
        const syncedDate = getDate('synced_at');
        const lastSyncDate = getDate('last_sync_attempt');
        const statusVal = getStatus();
        const paidAt = (statusVal === 'completed' || statusVal === 'paid') ? toMySQLDateTime(new Date()) : null;

        const params: (string | number | null | boolean)[] = [
          typeof r.id === 'string' ? r.id : (typeof r.id === 'number' ? String(r.id) : null), // uuid_id - the 19-digit UUID string
          getNumber('business_id'),
          getNumber('user_id'),
          getNumber('waiter_id'),
          typeof finalShiftUuid === 'string' ? finalShiftUuid : null,
          getString('payment_method'),
          getString('pickup_method'),
          getNumber('total_amount') ?? 0,
          getNumber('voucher_discount') ?? 0.0,
          getString('voucher_type') ?? 'none',
          getNumber('voucher_value'),
          getString('voucher_label'),
          getNumber('final_amount') ?? 0,
          getNumber('amount_received') ?? 0,
          getNumber('change_amount') ?? 0.0,
          statusVal,
          createdAt,
          toMySQLDateTime(new Date()),
          syncedDate ? toMySQLDateTime(syncedDate as string | number | Date) : null,
          getString('sync_status') ?? 'pending',
          getNumber('sync_attempts') ?? 0,
          lastSyncDate ? toMySQLDateTime(lastSyncDate as string | number | Date) : null,
          getNumber('contact_id'),
          getString('customer_name'),
          getNumber('customer_unit'),
          getString('note'),
          getString('bank_name'),
          getString('card_number'),
          getString('cl_account_id'),
          getString('cl_account_name'),
          getNumber('bank_id'),
          getString('receipt_number'),
          getString('transaction_type') ?? 'drinks',
          getNumber('payment_method_id') ?? 0,
          getNumber('table_id'),
          paidAt
        ];

        console.log('📝 [MYSQL] Calling executeTransaction with params:', params);
        console.log('📊 [MYSQL] Params count:', params.length);

        queries.push({
          sql: `INSERT INTO transactions (
            uuid_id, business_id, user_id, waiter_id, shift_uuid, payment_method, pickup_method, total_amount,
            voucher_discount, voucher_type, voucher_value, voucher_label, final_amount, amount_received, change_amount, status,
            created_at, updated_at, synced_at, sync_status, sync_attempts, last_sync_attempt, contact_id, customer_name, customer_unit, note, bank_name,
            card_number, cl_account_id, cl_account_name, bank_id, receipt_number,
            transaction_type, payment_method_id, table_id, paid_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            business_id=VALUES(business_id), user_id=VALUES(user_id), waiter_id=VALUES(waiter_id), shift_uuid=VALUES(shift_uuid), payment_method=VALUES(payment_method),
            pickup_method=VALUES(pickup_method), total_amount=VALUES(total_amount), voucher_discount=VALUES(voucher_discount),
            voucher_type=VALUES(voucher_type), voucher_value=VALUES(voucher_value), voucher_label=VALUES(voucher_label),
            final_amount=VALUES(final_amount), amount_received=VALUES(amount_received), change_amount=VALUES(change_amount),
            status=VALUES(status), created_at=VALUES(created_at), updated_at=VALUES(updated_at), synced_at=VALUES(synced_at),
            sync_status=VALUES(sync_status), sync_attempts=VALUES(sync_attempts), last_sync_attempt=VALUES(last_sync_attempt),
            contact_id=VALUES(contact_id), customer_name=VALUES(customer_name), customer_unit=VALUES(customer_unit), note=VALUES(note),
            bank_name=VALUES(bank_name), card_number=VALUES(card_number), cl_account_id=VALUES(cl_account_id),
            cl_account_name=VALUES(cl_account_name), bank_id=VALUES(bank_id), receipt_number=VALUES(receipt_number),
            transaction_type=VALUES(transaction_type), payment_method_id=VALUES(payment_method_id), table_id=VALUES(table_id),
            paid_at=IF(VALUES(status) IN ('completed','paid'), IFNULL(paid_at, VALUES(paid_at)), paid_at)`,
          params
        });
      }

      if (queries.length > 0) {
        await executeTransaction(queries);
        console.log('✅ [MYSQL] Transaction upsert successful');
      }
      return { success: true };
    } catch (err: unknown) {
      console.error('❌ [MYSQL] Transaction upsert error:', err);
      if (err && typeof err === 'object' && 'code' in err) {
        console.error('📝 [MYSQL] Error code:', (err as { code: unknown }).code);
      }
      if (err && typeof err === 'object' && 'message' in err) {
        console.error('📝 [MYSQL] Error message:', (err as { message: unknown }).message);
      }
      return { success: false };
    }
  });

  ipcMain.handle('localdb-update-transaction-voucher', async (
    _event,
    transactionId: string,
    payload: { voucher_discount: number; voucher_type: string; voucher_value: number | null; voucher_label: string | null; final_amount: number }
  ) => {
    try {
      if (!transactionId || typeof transactionId !== 'string') {
        return { success: false, error: 'transactionId required' };
      }
      const { voucher_discount, voucher_type, voucher_value, voucher_label, final_amount } = payload;
      await executeUpdate(
        `UPDATE transactions SET voucher_discount = ?, voucher_type = ?, voucher_value = ?, voucher_label = ?, final_amount = ?, updated_at = NOW() WHERE uuid_id = ?`,
        [voucher_discount, voucher_type || 'none', voucher_value, voucher_label, final_amount, transactionId]
      );
      return { success: true };
    } catch (err) {
      console.error('localdb-update-transaction-voucher error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('localdb-update-transaction-waiter', async (_event, transactionId: string, waiterId: number | null) => {
    try {
      if (!transactionId || typeof transactionId !== 'string') {
        return { success: false, error: 'transactionId required' };
      }
      await executeUpdate(
        `UPDATE transactions SET waiter_id = ?, updated_at = NOW() WHERE uuid_id = ?`,
        [waiterId, transactionId]
      );
      return { success: true };
    } catch (err) {
      console.error('localdb-update-transaction-waiter error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  /** Ensure checker_printed column exists (for DBs created before this column). */
  async function ensureCheckerPrintedColumn(): Promise<void> {
    try {
      await executeUpdate(
        `ALTER TABLE transactions ADD COLUMN checker_printed TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = kitchen labels/checker already printed for this order'`
      );
      console.log('✅ transactions: added checker_printed column');
    } catch (alterErr: unknown) {
      const err = alterErr as { code?: string; errno?: number };
      if (err.code === 'ER_DUP_FIELDNAME' || err.errno === 1060) {
        // Column already exists
      } else {
        console.warn('⚠️ transactions checker_printed column:', (alterErr as Error)?.message);
      }
    }
  }

  ipcMain.handle('localdb-get-transaction-checker-printed', async (_event, transactionUuid: string) => {
    try {
      if (!transactionUuid || typeof transactionUuid !== 'string') {
        return { success: false, checker_printed: false };
      }
      let row: { checker_printed: number | null } | null = null;
      try {
        row = await executeQueryOne<{ checker_printed: number | null }>(
          'SELECT checker_printed FROM transactions WHERE uuid_id = ? LIMIT 1',
          [transactionUuid]
        );
      } catch (queryErr: unknown) {
        const err = queryErr as { errno?: number; code?: string };
        if (err.errno === 1054 || err.code === 'ER_BAD_FIELD_ERROR') {
          await ensureCheckerPrintedColumn();
          row = await executeQueryOne<{ checker_printed: number | null }>(
            'SELECT checker_printed FROM transactions WHERE uuid_id = ? LIMIT 1',
            [transactionUuid]
          );
        } else {
          throw queryErr;
        }
      }
      const checker_printed = row?.checker_printed === 1;
      return { success: true, checker_printed };
    } catch (err) {
      // If column doesn't exist (old DB), treat as not printed so we still print labels
      return { success: true, checker_printed: false };
    }
  });

  ipcMain.handle('localdb-set-transaction-checker-printed', async (_event, transactionUuid: string) => {
    try {
      if (!transactionUuid || typeof transactionUuid !== 'string') {
        return { success: false };
      }
      try {
        await executeUpdate(
          'UPDATE transactions SET checker_printed = 1 WHERE uuid_id = ?',
          [transactionUuid]
        );
      } catch (updateErr: unknown) {
        const err = updateErr as { errno?: number; code?: string };
        if (err.errno === 1054 || err.code === 'ER_BAD_FIELD_ERROR') {
          await ensureCheckerPrintedColumn();
          await executeUpdate(
            'UPDATE transactions SET checker_printed = 1 WHERE uuid_id = ?',
            [transactionUuid]
          );
        } else {
          throw updateErr;
        }
      }
      return { success: true };
    } catch (err) {
      console.error('localdb-set-transaction-checker-printed error:', err);
      return { success: false };
    }
  });

  ipcMain.handle('localdb-get-transactions', async (event, businessId?: number, limit?: number, options?: { todayOnly?: boolean }) => {
    try {
      const todayOnly = options?.todayOnly === true;

      // Diagnostic logging
      const diagLogPathTx = path.join(app.getPath('userData'), 'path-diagnostic.log');
      try {
        const txCountResult = await executeQueryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM transactions');
        const txCount = txCountResult?.cnt || 0;
        fs.appendFileSync(diagLogPathTx, `${new Date().toISOString()} [GET-TX] businessId=${businessId}, limit=${limit}, todayOnly=${todayOnly}, totalTxInDb=${txCount}\n`);
      } catch (e) {
        try { fs.appendFileSync(diagLogPathTx, `${new Date().toISOString()} [GET-TX] ERROR: ${e}\n`); } catch (e2) { }
      }

      let query = `
        SELECT 
          t.*,
          t.final_amount,
          t.total_amount,
          COALESCE(t.uuid_id, t.id) as id,
          CASE 
            WHEN t.created_at IS NOT NULL THEN
              ROW_NUMBER() OVER (
                PARTITION BY DATE(t.created_at), t.business_id
                ORDER BY t.created_at ASC
              )
            ELSE NULL
          END as receipt_number,
          COALESCE(
            NULLIF(t.refund_total, 0),
            COALESCE(refund_summary.total_refund, 0)
          ) as refund_total,
          -- Always recalculate refund_status based on total refund amount vs final_amount
          -- This ensures correct status even if database has incorrect values
          CASE 
            WHEN COALESCE(refund_summary.total_refund, t.refund_total, 0) > 0 THEN
              CASE 
                WHEN COALESCE(refund_summary.total_refund, t.refund_total, 0) >= ((t.final_amount - COALESCE(cancelled.total_cancelled, 0)) - 0.01) THEN 'full'
                ELSE 'partial'
              END
            ELSE 'none'
          END as refund_status
        FROM transactions t
        LEFT JOIN (
          SELECT 
            transaction_id, 
            uuid_transaction_id,
            SUM(total_price) as total_cancelled
          FROM transaction_items
          WHERE production_status = 'cancelled'
          GROUP BY uuid_transaction_id, transaction_id
        ) cancelled ON (t.uuid_id = cancelled.uuid_transaction_id OR t.id = cancelled.transaction_id)
        LEFT JOIN (
          SELECT 
            transaction_uuid,
            SUM(refund_amount) as total_refund,
            COUNT(*) as refund_count,
            MAX(status) as max_status
          FROM transaction_refunds
          WHERE status IN ('pending', 'completed')
          GROUP BY transaction_uuid
        ) refund_summary ON t.uuid_id = refund_summary.transaction_uuid
      `;
      const params: (string | number | null | boolean)[] = [];
      const conditions: string[] = [];

      // Exclude archived transactions
      conditions.push('t.status != \'archived\'');

      // Kitchen/barista display optimization: fetch only today's active orders
      if (todayOnly) {
        conditions.push('DATE(t.created_at) = CURDATE()');
        conditions.push("t.status IN ('pending', 'paid', 'completed')");
      }

      if (businessId) {
        conditions.push('t.business_id = ?');
        params.push(businessId);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY t.created_at DESC';

      // LIMIT cannot be parameterized with window functions in some MySQL versions
      // Validate and use string interpolation (safe since we validate it's a number)
      if (limit && typeof limit === 'number' && limit > 0) {
        const safeLimit = Math.min(Math.max(limit, 1), 100000); // Cap at 100k for safety
        query += ` LIMIT ${safeLimit}`;
      }

      const results = await executeQuery(query, params);

      // Diagnostic logging
      try { fs.appendFileSync(diagLogPathTx, `${new Date().toISOString()} [GET-TX] Returned ${results.length} transactions\n`); } catch (e) { }

      // Debug: Check for specific transaction UUID and verify refunds exist in database
      const specificTx = (results as unknown[]).find((tx: unknown): tx is Record<string, unknown> => {
        if (typeof tx === 'object' && tx !== null) {
          const txRecord = tx as Record<string, unknown>;
          const txId = typeof txRecord.id === 'string' ? txRecord.id : (typeof txRecord.id === 'number' ? String(txRecord.id) : '');
          const txUuidId = typeof txRecord.uuid_id === 'string' ? txRecord.uuid_id : '';
          return (txId === '0142512271637510001' || txUuidId === '0142512271637510001');
        }
        return false;
      });
      if (specificTx) {
        // Query refunds directly from database for this transaction
        try {
          const txUuidId = typeof specificTx.uuid_id === 'string' ? specificTx.uuid_id : (typeof specificTx.id === 'string' ? specificTx.id : (typeof specificTx.id === 'number' ? String(specificTx.id) : ''));
          const refundCheck = await executeQuery(`
            SELECT 
              transaction_uuid,
              SUM(refund_amount) as total_refund,
              COUNT(*) as refund_count,
              GROUP_CONCAT(status) as statuses,
              GROUP_CONCAT(refund_amount) as amounts
            FROM transaction_refunds
            WHERE transaction_uuid = ?
            GROUP BY transaction_uuid
          `, [txUuidId]);

          console.log(`🔍 [GET-TX] Debug for transaction 0142512271637510001:`, {
            id: specificTx.id,
            uuid_id: specificTx.uuid_id,
            refund_total_from_query: specificTx.refund_total,
            refund_status_from_query: specificTx.refund_status,
            final_amount: specificTx.final_amount,
            refunds_in_db: refundCheck.length > 0 ? refundCheck[0] : null,
            refund_total_in_transactions_table: specificTx.refund_total,
            refund_status_in_transactions_table: specificTx.refund_status
          });
        } catch (refundError) {
          console.error('❌ [GET-TX] Error checking refunds:', refundError);
        }
      }

      // Debug: Log transactions with refunds to verify refund_total is being calculated
      if (results.length > 0) {
        const transactionsWithRefunds = results.filter((tx: any) => {
          const refundTotal = tx.refund_total;
          return refundTotal && refundTotal > 0;
        });
        if (transactionsWithRefunds.length > 0) {
          console.log(`💰 [GET-TX] Found ${transactionsWithRefunds.length} transaction(s) with refunds:`,
            transactionsWithRefunds.slice(0, 3).map((tx: any) => ({
              id: tx.id || tx.uuid_id,
              refund_total: tx.refund_total,
              refund_status: tx.refund_status,
              final_amount: tx.final_amount
            }))
          );
        }
      }

      return results;
    } catch (error) {
      console.error('Error getting transactions:', error);
      return [];
    }
  });

  const ensureIsoString = (value?: string | null): string | null => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  };

  const buildTransactionFilter = (
    businessId: number,
    startIso?: string | null,
    endIso?: string | null,
    alias?: string
  ) => {
    const prefix = alias ? `${alias}.` : '';
    const conditions: string[] = [`${prefix}business_id = ?`];
    const params: QueryParams = [businessId];

    if (startIso) {
      conditions.push(`${prefix}created_at >= ?`);
      params.push(toMySQLDateTime(startIso));
    }
    if (endIso) {
      conditions.push(`${prefix}created_at <= ?`);
      params.push(toMySQLDateTime(endIso));
    }

    return { clause: conditions.join(' AND '), params };
  };

  // Archive transactions
  ipcMain.handle('localdb-archive-transactions', async (event, payload: { businessId: number; from?: string | null; to?: string | null }) => {
    const businessId = payload?.businessId;
    if (!businessId) return 0;

    const startIso = ensureIsoString(payload.from);
    const endIso = ensureIsoString(payload.to);

    try {
      const { clause: baseClause, params } = buildTransactionFilter(businessId, startIso, endIso);
      const timestamp = Date.now();

      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];

      // Update transactions to archived
      queries.push({
        sql: `
          UPDATE transactions 
          SET status = 'archived', updated_at = ?
          WHERE ${baseClause} AND status != 'archived'
        `,
        params: [timestamp, ...params]
      });

      await executeTransaction(queries);

      const archivedClause = `${baseClause} AND status = 'archived'`;
      const countResult = await executeQueryOne<{ count: number }>(`
        SELECT COUNT(*) as count FROM transactions WHERE ${archivedClause}
      `, params);
      const archivedCount = countResult?.count || 0;
      console.log(`✅ [ARCHIVE] Archived ${archivedCount} transactions`);

      const archivedUuids = await executeQuery<{ uuid_id: string }>(
        `SELECT uuid_id FROM transactions WHERE ${archivedClause}`,
        params
      );
      const uuidList = archivedUuids.map(r => r.uuid_id);
      if (uuidList.length > 0) {
        const uuidPh = uuidList.map(() => '?').join(',');
        try {
          await executeUpdate(`DELETE FROM printer1_audit_log WHERE transaction_id IN (${uuidPh})`, uuidList);
          await executeUpdate(`DELETE FROM printer2_audit_log WHERE transaction_id IN (${uuidPh})`, uuidList);
        } catch (e) {
          console.warn('⚠️ [ARCHIVE] Failed to clear printer audits for archived transactions:', e);
        }
      }
      return archivedCount;
    } catch (error) {
      console.error('❌ [ARCHIVE] Failed to archive transactions:', error);
      throw error;
    }
  });

  // Delete transactions permanently (salespulse + system_pos). Resets printer daily counters for businessId.
  ipcMain.handle('localdb-delete-transactions', async (event, payload: { businessId: number; from?: string | null; to?: string | null }) => {
    const businessId = payload?.businessId;
    if (!businessId) return 0;

    const startIso = ensureIsoString(payload.from);
    const endIso = ensureIsoString(payload.to);

    try {
      const { clause: baseClause, params } = buildTransactionFilter(businessId, startIso, endIso);

      const rows = await executeQuery<{ id: number; uuid_id: string }>(
        `SELECT id, uuid_id FROM transactions WHERE ${baseClause}`,
        params
      );
      const deletedCount = rows.length;
      if (deletedCount === 0) {
        console.log(`🗑️ [DELETE] No transactions to delete`);
        return 0;
      }

      const transactionIds = rows.map(r => r.id);
      const transactionUuids = rows.map(r => r.uuid_id);
      const placeholders = transactionIds.map(() => '?').join(',');
      const uuidPlaceholders = transactionUuids.map(() => '?').join(',');

      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];

      // Printer audits use transaction_id = uuid_id (not id)
      queries.push({
        sql: `DELETE FROM printer1_audit_log WHERE transaction_id IN (${uuidPlaceholders})`,
        params: [...transactionUuids]
      });
      queries.push({
        sql: `DELETE FROM printer2_audit_log WHERE transaction_id IN (${uuidPlaceholders})`,
        params: [...transactionUuids]
      });
      // offline_refunds: delete orphan refunds for deleted transactions
      queries.push({
        sql: `DELETE FROM offline_refunds WHERE JSON_UNQUOTE(JSON_EXTRACT(refund_data, '$.transaction_uuid')) IN (${uuidPlaceholders})`,
        params: [...transactionUuids]
      });
      queries.push({
        sql: `DELETE FROM transactions WHERE ${baseClause}`,
        params: [...params]
      });

      await executeTransaction(queries);

      // system_pos: queue then transactions (by uuid)
      const sysPosQueries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];
      sysPosQueries.push({
        sql: `DELETE FROM system_pos_queue WHERE transaction_id IN (${uuidPlaceholders})`,
        params: [...transactionUuids]
      });
      sysPosQueries.push({
        sql: `DELETE FROM transactions WHERE uuid_id IN (${uuidPlaceholders})`,
        params: [...transactionUuids]
      });
      await executeSystemPosTransaction(sysPosQueries);
      console.log(`🗑️ [DELETE] [system_pos] Deleted ${transactionUuids.length} queue rows and matching transactions`);

      // Reset printer daily counters for this business
      try {
        await executeUpdate(`DELETE FROM printer_daily_counters WHERE business_id = ?`, [businessId]);
        console.log(`[RESET] Cleared printer_daily_counters for business ${businessId}`);
      } catch (e) {
        console.warn(`[DELETE] Failed to reset printer daily counters for business ${businessId}:`, e);
      }

      console.log(`🗑️ [DELETE] Deleted ${deletedCount} transactions (salespulse + system_pos)`);
      return deletedCount;
    } catch (error) {
      console.error('❌ [DELETE] Failed to delete transactions:', error);
      throw error;
    }
  });

  // Preview and delete a single transaction by uuid (complete: all related tables). Limited to the given transaction id only.
  type SingleDeletePreviewQuery = { sql: string; params: (string | number)[]; description: string };
  ipcMain.handle('localdb-delete-single-transaction-preview', async (_event, transactionUuid: string) => {
    if (!transactionUuid || typeof transactionUuid !== 'string') {
      return { success: false, error: 'transactionUuid required', queries: [] as SingleDeletePreviewQuery[] };
    }
    try {
      const exists = await executeQueryOne<{ n: number }>('SELECT 1 as n FROM transactions WHERE uuid_id = ? LIMIT 1', [transactionUuid]);
      if (!exists?.n) {
        return { success: false, error: 'Transaction not found', queries: [] as SingleDeletePreviewQuery[] };
      }
      const queries: SingleDeletePreviewQuery[] = [
        { sql: 'DELETE FROM printer1_audit_log WHERE transaction_id = ?', params: [transactionUuid], description: 'Printer 1 audit log' },
        { sql: 'DELETE FROM printer2_audit_log WHERE transaction_id = ?', params: [transactionUuid], description: 'Printer 2 audit log' },
        { sql: 'DELETE FROM transactions WHERE uuid_id = ?', params: [transactionUuid], description: 'transactions (CASCADE: transaction_items, transaction_item_customizations, transaction_item_customization_options, transaction_refunds)' },
      ];
      return {
        success: true, transactionUuid, queries, systemPosQueries: [
          { sql: 'DELETE FROM system_pos_queue WHERE transaction_id = ?', params: [transactionUuid], description: 'system_pos: queue' },
          { sql: 'DELETE FROM transactions WHERE uuid_id = ?', params: [transactionUuid], description: 'system_pos: transactions' },
        ] as SingleDeletePreviewQuery[]
      };
    } catch (err) {
      console.error('localdb-delete-single-transaction-preview error:', err);
      return { success: false, error: (err as Error).message, queries: [] as SingleDeletePreviewQuery[] };
    }
  });

  ipcMain.handle('localdb-delete-single-transaction', async (_event, transactionUuid: string) => {
    if (!transactionUuid || typeof transactionUuid !== 'string') {
      return { success: false, error: 'transactionUuid required' };
    }
    try {
      const exists = await executeQueryOne<{ n: number }>('SELECT 1 as n FROM transactions WHERE uuid_id = ? LIMIT 1', [transactionUuid]);
      if (!exists?.n) {
        return { success: false, error: 'Transaction not found' };
      }
      const mainQueries: Array<{ sql: string; params?: (string | number)[] }> = [
        { sql: 'DELETE FROM printer1_audit_log WHERE transaction_id = ?', params: [transactionUuid] },
        { sql: 'DELETE FROM printer2_audit_log WHERE transaction_id = ?', params: [transactionUuid] },
        { sql: 'DELETE FROM transactions WHERE uuid_id = ?', params: [transactionUuid] },
      ];
      await executeTransaction(mainQueries);
      const sysPosQueries: Array<{ sql: string; params?: (string | number)[] }> = [
        { sql: 'DELETE FROM system_pos_queue WHERE transaction_id = ?', params: [transactionUuid] },
        { sql: 'DELETE FROM transactions WHERE uuid_id = ?', params: [transactionUuid] },
      ];
      await executeSystemPosTransaction(sysPosQueries);
      console.log(`🗑️ [DELETE] Deleted single transaction ${transactionUuid} (salespulse + system_pos)`);
      return { success: true };
    } catch (error) {
      console.error('❌ [DELETE] Failed to delete single transaction:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Delete transactions by user email (both offline and online)

  // Delete transaction items permanently
  ipcMain.handle('localdb-delete-transaction-items', async (event, payload: { businessId: number; from?: string | null; to?: string | null }) => {
    const businessId = payload?.businessId;
    if (!businessId) return { success: true };

    const startIso = ensureIsoString(payload.from);
    const endIso = ensureIsoString(payload.to);

    try {
      const { clause: baseClause, params } = buildTransactionFilter(businessId, startIso, endIso);

      // Get count before deletion
      const countResult = await executeQueryOne<{ count: number }>(`
        SELECT COUNT(*) as count FROM transaction_items 
        WHERE transaction_id IN (
          SELECT id FROM transactions WHERE ${baseClause}
        )
      `, params);
      const deletedCount = countResult?.count || 0;

      await executeUpdate(`
        DELETE FROM transaction_items 
        WHERE transaction_id IN (
          SELECT id FROM transactions WHERE ${baseClause}
        )
      `, params);

      console.log(`🗑️ [DELETE] Deleted ${deletedCount} transaction items`);
      return { success: true, deleted: deletedCount };
    } catch (error) {
      console.error('❌ [DELETE] Failed to delete transaction items:', error);
      throw error;
    }
  });

  // Get transactions that are not yet synced to cloud
  ipcMain.handle('localdb-get-unsynced-transactions', async (event, businessId?: number) => {
    try {
      // Return all transactions where sync_status = 'pending' or 'failed'
      // This includes both transactions that haven't been synced yet AND failed uploads
      let query = `
        SELECT 
          t.*,
          CASE 
            WHEN t.created_at IS NOT NULL THEN
              ROW_NUMBER() OVER (
                PARTITION BY DATE(t.created_at), t.business_id
                ORDER BY t.created_at ASC
              )
            ELSE NULL
          END as receipt_number
        FROM transactions t
        WHERE t.sync_status IN ('pending', 'failed')
      `;
      const params: (string | number | null | boolean)[] = [];

      if (businessId) {
        query += ' AND t.business_id = ?';
        params.push(businessId);
      }

      query += ' ORDER BY t.created_at DESC';

      const transactions = await executeQuery(query, params);

      // ✅ NEW: Fetch transaction items for each transaction
      if (Array.isArray(transactions) && transactions.length > 0) {
        for (const transaction of transactions as any[]) {
          const items = await executeQuery('SELECT * FROM transaction_items WHERE transaction_id = ?', [transaction.id]);
          transaction.items = items || [];
        }
      }

      return transactions;
    } catch (error) {
      console.error('Error getting unsynced transactions:', error);
      return [];
    }
  });

  // Get ALL transactions (for re-sync purposes)
  ipcMain.handle('localdb-get-all-transactions', async (event, businessId?: number, from?: string, to?: string) => {
    try {
      let query = `
        SELECT 
          t.*,
          CASE 
            WHEN t.created_at IS NOT NULL THEN
              ROW_NUMBER() OVER (
                PARTITION BY DATE(t.created_at), t.business_id
                ORDER BY t.created_at ASC
              )
            ELSE NULL
          END as receipt_number
        FROM transactions t
        WHERE 1=1
      `;
      const params: (string | number | null | boolean)[] = [];

      if (businessId) {
        query += ' AND t.business_id = ?';
        params.push(businessId);
      }

      const ensureIsoString = (value?: string | null): string | null => {
        if (!value) return null;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return date.toISOString();
      };

      const startIso = ensureIsoString(from);
      const endIso = ensureIsoString(to);

      if (startIso) {
        query += ' AND t.created_at >= ?';
        params.push(toMySQLDateTime(startIso));
      }
      if (endIso) {
        query += ' AND t.created_at <= ?';
        params.push(toMySQLDateTime(endIso)); // Include the entire end date (e.g. if time is 00:00:00, equal might miss end of day if caller doesn't handle it. But toMySQLDateTime usually handles it if input is correct. Assuming caller passes end of day or date only)
      }

      query += ' ORDER BY t.created_at DESC';

      const transactions = await executeQuery(query, params);

      // Fetch transaction items for each transaction
      if (Array.isArray(transactions) && transactions.length > 0) {
        for (const transaction of transactions as any[]) {
          const items = await executeQuery('SELECT * FROM transaction_items WHERE transaction_id = ?', [transaction.id]);
          transaction.items = items || [];
        }
      }

      return transactions;
    } catch (error) {
      console.error('Error getting all transactions:', error);
      return [];
    }
  });

  // Delete unsynced transactions (data offline yang akan diunggah)
  ipcMain.handle('localdb-delete-unsynced-transactions', async (event, businessId?: number) => {
    try {
      console.log(`🗑️ [SYNC] Deleting unsynced transactions, businessId: ${businessId || 'all'}`);

      // Build WHERE clause for filtering
      let whereClause = 'synced_at IS NULL';
      const params: (string | number | null | boolean)[] = [];
      if (businessId) {
        whereClause += ' AND business_id = ?';
        params.push(businessId);
      }

      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];

      // Step 1: Delete transaction_item_customization_options (depends on customizations)
      queries.push({
        sql: `
          DELETE FROM transaction_item_customization_options
          WHERE transaction_item_customization_id IN (
            SELECT tic.id FROM transaction_item_customizations tic
            INNER JOIN transaction_items ti ON tic.transaction_item_id = ti.id
            INNER JOIN transactions t ON ti.transaction_id = t.id
            WHERE ${whereClause}
          )
        `,
        params: [...params]
      });

      // Step 2: Delete transaction_item_customizations (depends on transaction_items)
      queries.push({
        sql: `
          DELETE FROM transaction_item_customizations
          WHERE transaction_item_id IN (
            SELECT id FROM transaction_items
            WHERE transaction_id IN (
              SELECT id FROM transactions WHERE ${whereClause}
            )
          )
        `,
        params: [...params]
      });

      // Step 3: Delete transaction_items (depends on transactions)
      queries.push({
        sql: `
          DELETE FROM transaction_items 
          WHERE transaction_id IN (
            SELECT id FROM transactions WHERE ${whereClause}
          )
        `,
        params: [...params]
      });

      // Step 4: Delete transaction_refunds (uses transaction_uuid, not foreign key but should be deleted)
      queries.push({
        sql: `
          DELETE FROM transaction_refunds
          WHERE transaction_uuid IN (
            SELECT id FROM transactions WHERE ${whereClause}
          )
        `,
        params: [...params]
      });

      // Step 5: Finally delete transactions
      queries.push({
        sql: `DELETE FROM transactions WHERE ${whereClause}`,
        params: [...params]
      });

      // Get count before deletion
      const countResult = await executeQueryOne<{ count: number }>(`
        SELECT COUNT(*) as count FROM transactions WHERE ${whereClause}
      `, params);
      const deletedCount = countResult?.count || 0;

      // Execute all deletions in a transaction
      await executeTransaction(queries);

      console.log(`✅ [SYNC] Deleted ${deletedCount} unsynced transactions`);

      return {
        success: true,
        deletedCount
      };
    } catch (error) {
      console.error('❌ [SYNC] Error deleting unsynced transactions:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  // Transaction Items
  ipcMain.handle('localdb-upsert-transaction-items', async (event, rows: RowArray) => {
    try {
      await ensureTransactionItemsWaiterIdColumn();
      await ensureTransactionItemsPackageLineFinishedAtColumn();
      await ensureTransactionItemPackageLinesFinishedAtColumn();
      await ensureTransactionItemsCancellationColumns();
      console.log('🔍 [MYSQL] Inserting transaction items:', rows.length); const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];

      // Map to store transaction UUID -> INT id lookups
      const transactionIdMap = new Map<string, number>();
      /** Package payloads to write to transaction_item_package_lines after transaction_items are inserted */
      const packageLinesToSave: { itemUuidId: string; itemQuantity: number; rawJson: string }[] = [];

      for (const r of rows) {
        console.log('📦 [MYSQL] Item data:', {
          id: r.id,
          transaction_id: r.transaction_id,
          product_id: r.product_id,
          custom_note: r.custom_note
        });

        // Handle bundle selections (still JSON for structure, but extract customizations to normalized tables)
        let bundleSelectionsJson = null;
        let bundleSelectionsData: RawBundleSelection[] | null = null;
        if (r.bundle_selections_json) {
          bundleSelectionsJson = typeof r.bundle_selections_json === 'string'
            ? r.bundle_selections_json
            : JSON.stringify(r.bundle_selections_json);

          // Parse to extract bundle product customizations
          try {
            bundleSelectionsData = parseJsonArray<RawBundleSelection>(bundleSelectionsJson, 'bundle_selections_json');
          } catch (error) {
            console.warn('⚠️ Failed to parse bundle_selections_json:', error);
          }
        }

        // Package selections: persist full JSON (with per-item notes) in transaction_items; also write lines to transaction_item_package_lines for id/finished_at
        const rawPackageJson = (r as Record<string, unknown>).package_selections_json;
        const packageSelectionsJson =
          rawPackageJson == null
            ? null
            : typeof rawPackageJson === 'string'
              ? rawPackageJson
              : JSON.stringify(rawPackageJson);
        if (rawPackageJson) {
          const itemUuidIdForPackage = typeof (r as any).uuid_id === 'string' && (r as any).uuid_id ? (r as any).uuid_id : (typeof r.id === 'string' ? r.id : String(r.id ?? ''));
          const itemQty = typeof r.quantity === 'number' ? r.quantity : (typeof r.quantity === 'string' ? parseInt(String(r.quantity), 10) : 1);
          packageLinesToSave.push({
            itemUuidId: itemUuidIdForPackage,
            itemQuantity: itemQty,
            rawJson: typeof rawPackageJson === 'string' ? rawPackageJson : JSON.stringify(rawPackageJson),
          });
        }

        console.log('📝 [MYSQL] Custom note:', r.custom_note);

        // Use UUID columns: uuid_id (item UUID) and uuid_transaction_id (transaction UUID reference)
        // IMPORTANT: Use r.uuid_id if available, otherwise fall back to r.id as string
        const itemUuidId = typeof (r as any).uuid_id === 'string' && (r as any).uuid_id
          ? (r as any).uuid_id
          : (typeof r.id === 'string' ? r.id : String(r.id ?? ''));
        // IMPORTANT: Use uuid_transaction_id field, not transaction_id (which is 0 placeholder)
        const transactionUuidId = typeof r.uuid_transaction_id === 'string' ? r.uuid_transaction_id : (typeof r.transaction_id === 'string' ? r.transaction_id : String(r.transaction_id ?? ''));// Look up transaction INT id from UUID (cache results)
        let transactionIntId: number;
        if (transactionIdMap.has(transactionUuidId)) {
          transactionIntId = transactionIdMap.get(transactionUuidId)!;
        } else {
          try {
            const tx = await executeQueryOne<{ id: number }>(
              'SELECT id FROM transactions WHERE uuid_id = ? LIMIT 1',
              [transactionUuidId]
            ); if (tx && typeof tx.id === 'number') {
              transactionIntId = tx.id;
              transactionIdMap.set(transactionUuidId, transactionIntId);
            } else {
              console.warn(`⚠️ Transaction UUID ${transactionUuidId} not found, using 0 as placeholder`);
              transactionIntId = 0;
            }
          } catch (error) {
            console.error(`❌ Error looking up transaction ID for UUID ${transactionUuidId}:`, error);
            transactionIntId = 0;
          }
        }

        const productId = typeof r.product_id === 'number' ? r.product_id : (typeof r.product_id === 'string' ? parseInt(String(r.product_id), 10) : 0);
        const quantity = typeof r.quantity === 'number' ? r.quantity : (typeof r.quantity === 'string' ? parseInt(String(r.quantity), 10) : 1);
        const unitPrice = typeof r.unit_price === 'number' ? r.unit_price : (typeof r.unit_price === 'string' ? parseFloat(String(r.unit_price)) : 0);
        const totalPrice = typeof r.total_price === 'number' ? r.total_price : (typeof r.total_price === 'string' ? parseFloat(String(r.total_price)) : 0);
        const customNote = typeof r.custom_note === 'string' ? r.custom_note : (r.custom_note ? String(r.custom_note) : null);

        const getDate = (key: string) => {
          const val = r[key];
          if (val instanceof Date) return val;
          if (typeof val === 'string' || typeof val === 'number') return val;
          return null;
        };
        const createdDate = getDate('created_at');
        const createdAt = createdDate ? toMySQLDateTime(createdDate as string | number | Date) : toMySQLDateTime(new Date());

        // Handle production status fields
        const productionStatus = typeof r.production_status === 'string' ? r.production_status : (r.production_status ? String(r.production_status) : null);
        const productionStartedDate = getDate('production_started_at');
        const productionStartedAt = productionStartedDate ? toMySQLDateTime(productionStartedDate as string | number | Date) : null;
        const productionFinishedDate = getDate('production_finished_at');
        const productionFinishedAt = productionFinishedDate ? toMySQLDateTime(productionFinishedDate as string | number | Date) : null;
        const waiterIdItem = typeof (r as any).waiter_id === 'number' ? (r as any).waiter_id : (typeof (r as any).waiter_id === 'string' ? parseInt(String((r as any).waiter_id), 10) : null);
        const packageLineFinishedAtJson = (() => {
          const raw = (r as Record<string, unknown>).package_line_finished_at_json;
          if (raw == null) return null;
          if (typeof raw === 'string') return raw;
          try { return JSON.stringify(raw); } catch { return null; }
        })();

        const cancelledByUserId = typeof (r as any).cancelled_by_user_id === 'number' ? (r as any).cancelled_by_user_id : (typeof (r as any).cancelled_by_user_id === 'string' ? parseInt(String((r as any).cancelled_by_user_id), 10) : null);
        const cancelledByWaiterId = typeof (r as any).cancelled_by_waiter_id === 'number' ? (r as any).cancelled_by_waiter_id : (typeof (r as any).cancelled_by_waiter_id === 'string' ? parseInt(String((r as any).cancelled_by_waiter_id), 10) : null);
        const cancelledAtDate = getDate('cancelled_at');
        const cancelledAt = cancelledAtDate ? toMySQLDateTime(cancelledAtDate as string | number | Date) : null;

        console.log('🔧 [MYSQL] Production status update:', {
          itemId: r.id,
          itemUuidId,
          productionStatus,
          productionStartedAt,
          productionFinishedAt,
          cancelledByUserId,
          cancelledByWaiterId,
          cancelledAt
        });

        queries.push({
          sql: `INSERT INTO transaction_items (
            uuid_id, transaction_id, uuid_transaction_id, product_id, quantity, unit_price, total_price,
            bundle_selections_json, package_selections_json, custom_note, created_at, waiter_id,
            production_status, production_started_at, production_finished_at, package_line_finished_at_json,
            cancelled_by_user_id, cancelled_by_waiter_id, cancelled_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            transaction_id=VALUES(transaction_id), uuid_transaction_id=VALUES(uuid_transaction_id), product_id=VALUES(product_id), quantity=VALUES(quantity),
            unit_price=VALUES(unit_price), total_price=VALUES(total_price),
            bundle_selections_json=VALUES(bundle_selections_json), package_selections_json=VALUES(package_selections_json),
            custom_note=VALUES(custom_note), created_at=VALUES(created_at), waiter_id=VALUES(waiter_id),
            production_status=VALUES(production_status), production_started_at=VALUES(production_started_at), production_finished_at=VALUES(production_finished_at),
            package_line_finished_at_json=VALUES(package_line_finished_at_json),
            cancelled_by_user_id=VALUES(cancelled_by_user_id), cancelled_by_waiter_id=VALUES(cancelled_by_waiter_id),
            cancelled_at=VALUES(cancelled_at)`,
          params: [
            itemUuidId, transactionIntId, transactionUuidId, productId, quantity, unitPrice, totalPrice,
            bundleSelectionsJson, packageSelectionsJson, customNote, createdAt, waiterIdItem,
            productionStatus, productionStartedAt, productionFinishedAt, packageLineFinishedAtJson,
            cancelledByUserId, cancelledByWaiterId, cancelledAt
          ]
        });
      }

      // Insert all transaction items first
      if (queries.length > 0) { await executeTransaction(queries); }

      // Save package line items to transaction_item_package_lines (normalized table)
      // When an item already has package lines in DB (e.g. order was saved then paid), preserve them
      // so that kitchen/barista completion (finished_at) is not wiped by payment upsert.
      if (packageLinesToSave.length > 0) await ensureTransactionItemPackageLinesNoteColumn();
      const packageLineQueries: Array<{ sql: string; params?: (string | number)[] }> = [];
      for (const { itemUuidId, itemQuantity, rawJson } of packageLinesToSave) {
        try {
          const existingLines = await executeQuery<{ id: number }>(
            'SELECT id FROM transaction_item_package_lines WHERE uuid_transaction_item_id = ? LIMIT 1',
            [itemUuidId]
          );
          if (existingLines && existingLines.length > 0) {
            // Item already has package lines (e.g. from "Simpan Order" or previous send). Do not replace:
            // payment/upsert would otherwise wipe finished_at and make completed items reappear in active orders.
            continue;
          }
          const selections = parseJsonArray<{ selection_type: string; product_id?: number; quantity?: number; note?: string; chosen?: Array<{ product_id: number; quantity?: number; note?: string }> }>(rawJson, 'package_selections_json');
          // Store per-package quantity and note; display will multiply quantity by itemQuantity
          const byProduct = new Map<number, number>();
          const byProductNote = new Map<number, string>();
          for (const sel of selections || []) {
            if (sel.selection_type === 'default' && sel.product_id != null) {
              const q = typeof sel.quantity === 'number' ? sel.quantity : 1;
              byProduct.set(sel.product_id, (byProduct.get(sel.product_id) || 0) + q);
              if (sel.note?.trim()) byProductNote.set(sel.product_id, sel.note.trim());
            } else if (sel.selection_type === 'flexible' && Array.isArray(sel.chosen)) {
              for (const c of sel.chosen) {
                if (c.product_id == null) continue;
                const q = typeof c.quantity === 'number' ? c.quantity : 1;
                byProduct.set(c.product_id, (byProduct.get(c.product_id) || 0) + q);
                if (c.note?.trim()) byProductNote.set(c.product_id, c.note.trim());
              }
            }
          }
          packageLineQueries.push({ sql: 'DELETE FROM transaction_item_package_lines WHERE uuid_transaction_item_id = ?', params: [itemUuidId] });
          for (const [pid, qty] of byProduct.entries()) {
            if (qty > 0) {
              const note = byProductNote.get(pid) ?? '';
              packageLineQueries.push({
                sql: 'INSERT INTO transaction_item_package_lines (uuid_transaction_item_id, product_id, quantity, note, finished_at) VALUES (?, ?, ?, ?, NULL)',
                params: [itemUuidId, pid, qty, note],
              });
            }
          }
        } catch (err) {
          console.warn('⚠️ Failed to parse package lines for item', itemUuidId, err);
        }
      }
      if (packageLineQueries.length > 0) {
        await executeTransaction(packageLineQueries.map((q) => ({ sql: q.sql, params: q.params ?? [] })));
      }

      // Then save customizations for each item (after items are inserted)
      for (const r of rows) {
        // Save main product customizations directly to normalized tables (NO JSON)
        if (r.customizations && Array.isArray(r.customizations)) {
          try {
            const customizations = r.customizations as RawCustomization[];
            if (customizations.length > 0) {
              // CRITICAL: Use uuid_id (UUID string) not id (numeric) for lookup
              // saveCustomizationsToNormalizedTables looks up items by uuid_id
              const itemUuid: string = (r.uuid_id as string) || (typeof r.id === 'string' ? r.id : String(r.id ?? ''));
              const createdAt = r.created_at ? (typeof r.created_at === 'number' || typeof r.created_at === 'string' ? r.created_at : new Date()) : new Date();
              const createdAtStr = typeof createdAt === 'string' ? createdAt : (createdAt instanceof Date ? toMySQLTimestamp(createdAt) : toMySQLTimestamp(new Date()));
              if (createdAtStr) {
                await saveCustomizationsToNormalizedTables(
                  itemUuid,
                  customizations,
                  createdAtStr
                );
              }
            }
          } catch (error) {
            console.error('❌ Error saving main product customizations to normalized tables:', error);
          }
        } else {
        }

        // Extract and save bundle product customizations to normalized tables (NO JSON)
        let bundleSelectionsData: RawBundleSelection[] | null = null;
        if (r.bundle_selections_json) {
          try {
            const bundleSelectionsJson = typeof r.bundle_selections_json === 'string'
              ? r.bundle_selections_json
              : JSON.stringify(r.bundle_selections_json);
            bundleSelectionsData = parseJsonArray<RawBundleSelection>(bundleSelectionsJson, 'bundle_selections_json');
          } catch (error) {
            console.warn('⚠️ Failed to parse bundle_selections_json:', error);
          }
        }

        if (bundleSelectionsData && bundleSelectionsData.length > 0) {
          try {
            // CRITICAL: Use uuid_id (UUID string) not id (numeric) for lookup
            const transactionItemUuid: string = (r.uuid_id as string) || (typeof r.id === 'string' ? r.id : String(r.id ?? ''));
            const createdAt = r.created_at ? (typeof r.created_at === 'number' || typeof r.created_at === 'string' ? r.created_at : new Date()) : new Date();
            const createdAtTimestamp = toMySQLTimestamp(createdAt);

            for (const bundleSelection of bundleSelectionsData) {
              if (!Array.isArray(bundleSelection.selectedProducts)) continue;

              for (const selectedProduct of bundleSelection.selectedProducts) {
                // Each bundle product can have customizations
                if (selectedProduct.customizations && Array.isArray(selectedProduct.customizations) && selectedProduct.customizations.length > 0) {
                  const bundleProductCustomizations = selectedProduct.customizations as RawCustomization[];

                  // Save bundle product customizations to normalized tables
                  // Link them to the bundle product ID so we can reconstruct them later
                  const bundleProductId = selectedProduct.product?.id || null;
                  const createdAtStr = typeof createdAt === 'string' ? createdAt : (createdAt instanceof Date ? toMySQLTimestamp(createdAt) : toMySQLTimestamp(new Date()));
                  if (createdAtStr) {
                    await saveCustomizationsToNormalizedTables(
                      transactionItemUuid,
                      bundleProductCustomizations,
                      createdAtStr,
                      bundleProductId
                    );
                  }
                }
              }
            }
          } catch (error) {
            console.error('❌ Error saving bundle product customizations to normalized tables:', error);
          }
        }
      }

      console.log('✅ [MYSQL] Transaction items inserted');
      return { success: true };
    } catch (error) {
      console.error('❌ Error upserting transaction items:', error);
      // Rethrow so renderer can show "Gagal" and retry; otherwise UI shows "Tersimpan" despite no save
      throw error;
    }
  });

  ipcMain.handle('localdb-get-transaction-items', async (event, transactionId?: number | string) => {
    try {// Get transaction items with product name from LEFT JOIN (includes inactive products)
      // Support both UUID and numeric ID lookups
      let items: Array<Record<string, unknown>> = [];
      if (transactionId) {
        // Try to match by uuid_transaction_id first (for UUID), then fallback to transaction_id (for numeric)
        // Check if it's a receipt number format (starts with digits but might have leading zeros)
        // IMPORTANT: Check receipt number format FIRST, as it's also numeric but needs UUID lookup
        const isReceiptNumberFormat = typeof transactionId === 'string' && /^0\d{15,}$/.test(String(transactionId).trim());
        const isNumeric = typeof transactionId === 'number' || (typeof transactionId === 'string' && /^\d+$/.test(String(transactionId).trim()));
        const isSimpleNumeric = isNumeric && !isReceiptNumberFormat; // Numeric but NOT receipt number format

        console.log(`[localdb-get-transaction-items] Looking for items with transactionId: ${transactionId} (isNumeric: ${isNumeric}, isReceiptNumberFormat: ${isReceiptNumberFormat}, isSimpleNumeric: ${isSimpleNumeric})`); if (isSimpleNumeric) {
          // Simple numeric ID (not receipt number format) - match by transaction_id
          items = await executeQuery<Record<string, unknown>>(`
            SELECT ti.*, p.nama as product_name 
            FROM transaction_items ti
            LEFT JOIN products p ON ti.product_id = p.id
            WHERE ti.transaction_id = ? 
            ORDER BY ti.id ASC
          `, [transactionId]);
        } else {
          // UUID or receipt number format - try multiple strategies to find items
          // Strategy 1: Try uuid_transaction_id directly (most direct match)
          items = await executeQuery<Record<string, unknown>>(`
            SELECT ti.*, p.nama as product_name 
            FROM transaction_items ti
            LEFT JOIN products p ON ti.product_id = p.id
            WHERE ti.uuid_transaction_id = ? 
            ORDER BY ti.id ASC
          `, [transactionId]);
          // Strategy 2: Join with transactions table to match by UUID or receipt_number
          if (items.length === 0) {
            console.log(`[localdb-get-transaction-items] No items found by uuid_transaction_id, trying transaction join with receipt_number`);
            // Try matching receipt_number as string (for formats like "0142512252257150001")
            items = await executeQuery<Record<string, unknown>>(`
              SELECT ti.*, p.nama as product_name 
              FROM transaction_items ti
              LEFT JOIN products p ON ti.product_id = p.id
              INNER JOIN transactions t ON ti.transaction_id = t.id
              WHERE t.uuid_id = ? 
                 OR CAST(t.receipt_number AS CHAR) = ?
                 OR t.receipt_number = ?
              ORDER BY ti.id ASC
            `, [transactionId, String(transactionId), transactionId]);
          }

          // Strategy 3: If still no items, find transaction's numeric ID and match by transaction_id
          if (items.length === 0) {
            console.log(`[localdb-get-transaction-items] No items found via join, trying to find by transaction numeric ID`);
            const transaction = await executeQuery<Record<string, unknown>>(`
              SELECT id, uuid_id, receipt_number FROM transactions 
              WHERE uuid_id = ? 
                 OR CAST(receipt_number AS CHAR) = ?
                 OR receipt_number = ?
                 OR id = ?
              LIMIT 1
            `, [transactionId, String(transactionId), transactionId, transactionId]);

            if (transaction && Array.isArray(transaction) && transaction.length > 0) {
              const tx = transaction[0] as Record<string, unknown>;
              const txId = typeof tx.id === 'number' ? tx.id : (typeof tx.id === 'string' ? Number(tx.id) : null);
              const txUuidId = typeof tx.uuid_id === 'string' ? tx.uuid_id : null;
              console.log(`[localdb-get-transaction-items] Found transaction:`, {
                id: tx.id,
                uuid_id: tx.uuid_id,
                receipt_number: tx.receipt_number
              });

              // Try with numeric ID
              if (txId !== null && !isNaN(txId)) {
                const numericId: number = txId;
                console.log(`[localdb-get-transaction-items] Querying items by transaction_id: ${numericId}`);
                items = await executeQuery<Record<string, unknown>>(`
                  SELECT ti.*, p.nama as product_name 
                  FROM transaction_items ti
                  LEFT JOIN products p ON ti.product_id = p.id
                  WHERE ti.transaction_id = ? 
                  ORDER BY ti.id ASC
                `, [numericId]);
              }

              // If still no items, try with UUID
              if (items.length === 0 && txUuidId) {
                console.log(`[localdb-get-transaction-items] Querying items by uuid_transaction_id: ${txUuidId}`);
                items = await executeQuery<Record<string, unknown>>(`
                  SELECT ti.*, p.nama as product_name 
                  FROM transaction_items ti
                  LEFT JOIN products p ON ti.product_id = p.id
                  WHERE ti.uuid_transaction_id = ? 
                  ORDER BY ti.id ASC
                `, [txUuidId]);
              }
            } else {
              console.log(`[localdb-get-transaction-items] Transaction not found in database for: ${transactionId}`);
            }
          }
        }

        console.log(`[localdb-get-transaction-items] Found ${items.length} items for transactionId: ${transactionId}`);
        if (items.length > 0) {
          console.log(`[localdb-get-transaction-items] Sample item:`, {
            id: items[0].id,
            product_id: items[0].product_id,
            product_name: items[0].product_name,
            transaction_id: items[0].transaction_id,
            uuid_transaction_id: items[0].uuid_transaction_id
          });
        }
      } else {
        items = await executeQuery<Record<string, unknown>>(`
          SELECT ti.*, p.nama as product_name 
          FROM transaction_items ti
          LEFT JOIN products p ON ti.product_id = p.id
          ORDER BY ti.created_at DESC
        `);
      }

      // Load package lines from transaction_item_package_lines for all items (normalized table; id + finished_at for completion)
      const itemUuids = items.map((i) => (i.uuid_id || i.id) as string).filter(Boolean);
      const packageLinesByItem = new Map<string, Array<{ id: number; product_id: number; product_name: string; quantity: number; note?: string | null; finished_at: string | null; category1_id?: number; category1_name?: string }>>();
      if (itemUuids.length > 0) {
        await ensureTransactionItemPackageLinesFinishedAtColumn();
        await ensureTransactionItemPackageLinesNoteColumn();
        const placeholders = itemUuids.map(() => '?').join(',');
        const packageRows = await executeQuery<Record<string, unknown>>(
          `SELECT tipl.id, tipl.uuid_transaction_item_id, ti.id as ti_id, tipl.product_id, tipl.quantity, tipl.note, tipl.finished_at,
                  p.nama as product_name, p.category1_id as category1_id, c1.name as category1_name
           FROM transaction_item_package_lines tipl
           LEFT JOIN transaction_items ti ON ti.uuid_id = tipl.uuid_transaction_item_id
           LEFT JOIN products p ON p.id = tipl.product_id
           LEFT JOIN category1 c1 ON p.category1_id = c1.id
           WHERE tipl.uuid_transaction_item_id IN (${placeholders})
           ORDER BY tipl.id ASC`,
          itemUuids
        );
        for (const row of packageRows || []) {
          const uuid = row.uuid_transaction_item_id as string;
          if (!uuid) continue;
          const lineEntry = {
            id: typeof row.id === 'number' ? row.id : parseInt(String(row.id || 0), 10),
            product_id: row.product_id as number,
            product_name: (row.product_name as string) || '',
            quantity: (row.quantity as number) || 1,
            note: row.note != null && String(row.note).trim() !== '' ? String(row.note) : undefined,
            finished_at: row.finished_at != null ? (typeof row.finished_at === 'string' ? row.finished_at : String(row.finished_at)) : null,
            category1_id: row.category1_id != null ? (typeof row.category1_id === 'number' ? row.category1_id : parseInt(String(row.category1_id), 10)) : undefined,
            category1_name: row.category1_name != null ? String(row.category1_name) : undefined,
          };
          if (!packageLinesByItem.has(uuid)) packageLinesByItem.set(uuid, []);
          packageLinesByItem.get(uuid)!.push(lineEntry);
          const tiId = row.ti_id != null ? String(row.ti_id) : null;
          if (tiId && tiId !== uuid) {
            if (!packageLinesByItem.has(tiId)) packageLinesByItem.set(tiId, []);
            packageLinesByItem.get(tiId)!.push({ ...lineEntry });
          }
        }
      }

      // For each item, load customizations from normalized tables
      const itemsWithCustomizations = await Promise.all(items.map(async (item) => {
        // Use uuid_id for reading customizations (function expects UUID, not INT id)
        const itemUuid = (item.uuid_id || item.id) as string;

        // Read main product customizations from normalized tables (bundle_product_id IS NULL)
        const customizations = await readCustomizationsFromNormalizedTables(itemUuid, null);

        // If item has bundle_selections_json, reconstruct it with customizations from normalized tables
        let bundleSelections = null;
        if (item.bundle_selections_json) {
          try {
            const bundleSelectionsJson = typeof item.bundle_selections_json === 'string'
              ? item.bundle_selections_json
              : JSON.stringify(item.bundle_selections_json);

            bundleSelections = parseJsonArray<RawBundleSelection>(bundleSelectionsJson, 'bundle_selections_json');

            // For each bundle selection, load customizations for each product from normalized tables
            if (bundleSelections && bundleSelections.length > 0) {
              bundleSelections = await Promise.all(bundleSelections.map(async (bundleSel) => {
                if (!Array.isArray(bundleSel.selectedProducts)) return bundleSel;

                return {
                  ...bundleSel,
                  selectedProducts: await Promise.all(bundleSel.selectedProducts.map(async (selectedProduct) => {
                    const bundleProductId = selectedProduct.product?.id;
                    if (!bundleProductId) return selectedProduct;

                    // Read customizations for this specific bundle product from normalized tables
                    const productCustomizations = await readCustomizationsFromNormalizedTables(
                      itemUuid,
                      bundleProductId
                    );

                    return {
                      ...selectedProduct,
                      customizations: productCustomizations || undefined
                    };
                  }))
                };
              }));
            }
          } catch (error) {
            console.warn('⚠️ Error reconstructing bundle selections:', error);
          }
        }

        // Attach package lines from transaction_item_package_lines (id + finished_at + note for Kitchen/Barista completion).
        // Prefer tipl.note from DB; fall back to index-based merge from package_selections_json for legacy rows inserted before note column.
        const package_selections_json = item.package_selections_json;
        const lines = packageLinesByItem.get(itemUuid) ?? (item.id != null ? packageLinesByItem.get(String(item.id)) : undefined);
        let linesWithNotes: Array<{ id: number; product_id: number; product_name: string; quantity: number; finished_at: string | null; category1_id?: number; category1_name?: string; note?: string }> | undefined;
        if (lines && lines.length > 0) {
          const flatNotes: string[] = [];
          if (package_selections_json) {
            try {
              const parsed = typeof package_selections_json === 'string' ? JSON.parse(package_selections_json) : package_selections_json;
              const arr = Array.isArray(parsed) ? parsed : [];
              for (const sel of arr) {
                if (sel.selection_type === 'default' && sel.product_id != null) {
                  flatNotes.push(sel.note?.trim() ?? '');
                } else if (sel.selection_type === 'flexible' && Array.isArray(sel.chosen)) {
                  for (const c of sel.chosen) {
                    flatNotes.push(c.note?.trim() ?? '');
                  }
                }
              }
            } catch (_) {}
          }
          linesWithNotes = lines.map((l, i) => ({
            ...l,
            note: (l.note != null && String(l.note).trim() !== '') ? l.note : (flatNotes[i] ? flatNotes[i] : undefined),
          }));
        }

        return {
          ...item,
          customizations: customizations || [],  // Main product customizations
          bundleSelections: bundleSelections || null,  // Bundle selections with customizations from normalized tables
          package_selections_json: package_selections_json ?? item.package_selections_json,
          packageBreakdownLines: linesWithNotes && linesWithNotes.length > 0 ? linesWithNotes : undefined,
        };
      }));

      return itemsWithCustomizations;
    } catch (error) {
      console.error('Error getting transaction items:', error);
      return [];
    }
  });

  /** Get all package lines for given transaction item UUID(s) (for completion check across kitchen + barista). */
  ipcMain.handle('localdb-get-package-lines', async (_event, uuidTransactionItemIds: string[]) => {
    try {
      if (!Array.isArray(uuidTransactionItemIds) || uuidTransactionItemIds.length === 0) return [];
      const placeholders = uuidTransactionItemIds.map(() => '?').join(',');
      const rows = await executeQuery<Record<string, unknown>>(
        `SELECT id, uuid_transaction_item_id, product_id, quantity, note, finished_at, created_at
         FROM transaction_item_package_lines
         WHERE uuid_transaction_item_id IN (${placeholders})
         ORDER BY id ASC`,
        uuidTransactionItemIds
      );
      return rows ?? [];
    } catch (error) {
      console.error('Error getting package lines:', error);
      return [];
    }
  });

  /** Returns transaction UUIDs that have at least one package line (for list filtering and package column). */
  ipcMain.handle('localdb-get-transaction-ids-with-package', async (_event, transactionIds: string[]) => {
    try {
      if (!Array.isArray(transactionIds) || transactionIds.length === 0) return [];
      const ids = transactionIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => '?').join(',');
      const rows = await executeQuery<{ uuid_transaction_id: string }>(
        `SELECT DISTINCT ti.uuid_transaction_id
         FROM transaction_items ti
         INNER JOIN transaction_item_package_lines tipl ON ti.uuid_id = tipl.uuid_transaction_item_id
         WHERE ti.uuid_transaction_id IN (${placeholders})`,
        ids
      );
      return (rows ?? []).map((r) => r.uuid_transaction_id);
    } catch (error) {
      console.error('Error getting transaction IDs with package:', error);
      return [];
    }
  });

  /** Update a single package line's finished_at (normalized completion, same as normal items). */
  ipcMain.handle('localdb-update-package-line', async (_event, payload: { id: number; finished_at: string | null }) => {
    try {
      const { id, finished_at } = payload;
      if (typeof id !== 'number' || isNaN(id)) {
        return { success: false, error: 'Invalid package line id' };
      }
      // MySQL TIMESTAMP expects 'YYYY-MM-DD HH:MM:SS', not ISO 8601 with T/Z
      const ts = finished_at == null ? null : toMySQLDateTime(finished_at);
      await executeUpdate(
        'UPDATE transaction_item_package_lines SET finished_at = ? WHERE id = ?',
        [ts, id]
      );
      return { success: true };
    } catch (error) {
      console.error('Error updating package line:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /** Returns distinct waiter_id per transaction from transaction_items (for multi-waiter display). Keys are uuid_transaction_id. */
  ipcMain.handle('localdb-get-distinct-item-waiter-ids-by-transaction', async (_event, transactionIds: string[]) => {
    try {
      await ensureTransactionItemsWaiterIdColumn();
      if (!Array.isArray(transactionIds) || transactionIds.length === 0) return {};
      const ids = transactionIds.filter((id): id is string => typeof id === 'string');
      if (ids.length === 0) return {};
      const placeholders = ids.map(() => '?').join(',');
      const rows = await executeQuery<{ uuid_transaction_id: string; waiter_id: number }>(
        `SELECT uuid_transaction_id, waiter_id FROM transaction_items WHERE uuid_transaction_id IN (${placeholders}) AND waiter_id IS NOT NULL`,
        ids
      );
      const byTx: Record<string, number[]> = {};
      for (const row of rows) {
        const txId = row.uuid_transaction_id;
        if (!byTx[txId]) byTx[txId] = [];
        if (!byTx[txId].includes(row.waiter_id)) byTx[txId].push(row.waiter_id);
      }
      return byTx;
    } catch (error) {
      console.error('localdb-get-distinct-item-waiter-ids-by-transaction error:', error);
      return {};
    }
  });

  // NEW: Get normalized customizations for transaction items (for sync upload)
  ipcMain.handle('localdb-get-transaction-item-customizations-normalized', async (event, transactionId: string) => {
    // #region agent log
    console.log('🔍 [DEBUG] Electron function called with transactionId:', transactionId);
    writeDebugLog(JSON.stringify({ location: 'main.ts:3762', message: 'Electron function called', data: { transactionId, type: typeof transactionId }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
    // #endregion

    try {
      // Get all transaction items for this transaction
      // Support both UUID and numeric ID lookups (similar to localDbGetTransactionItems)
      const isReceiptNumberFormat = typeof transactionId === 'string' && /^0\d{15,}$/.test(String(transactionId).trim());
      const isNumeric = typeof transactionId === 'number' || (typeof transactionId === 'string' && /^\d+$/.test(String(transactionId).trim()));
      const isSimpleNumeric = isNumeric && !isReceiptNumberFormat;

      // #region agent log
      console.log('🔍 [DEBUG] Transaction ID analysis:', { transactionId, isReceiptNumberFormat, isNumeric, isSimpleNumeric });
      writeDebugLog(JSON.stringify({ location: 'main.ts:3768', message: 'Transaction ID analysis', data: { transactionId, isReceiptNumberFormat, isNumeric, isSimpleNumeric }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
      // #endregion

      let items: Array<{ id: number }> = [];

      if (isSimpleNumeric) {
        // Simple numeric ID - match by transaction_id
        // Convert transactionId to number if it's a string
        const numericId = typeof transactionId === 'string' ? parseInt(transactionId, 10) : transactionId;
        items = await executeQuery<{ id: number }>('SELECT id FROM transaction_items WHERE transaction_id = ?', [numericId]);
        // #region agent log
        console.log('🔍 [DEBUG] Items found (numeric):', items.length, 'items for transaction_id', numericId, items.map(i => i.id));
        writeDebugLog(JSON.stringify({ location: 'main.ts:3786', message: 'Items found (numeric)', data: { transactionId, numericId, itemsCount: items.length, itemIds: items.map(i => i.id) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
        // #endregion

        // Debug: Check if customizations exist for these items
        if (items.length > 0) {
          const itemIdsForCheck = items.map(i => i.id);
          const placeholders = itemIdsForCheck.map(() => '?').join(',');
          const existingCustomizations = await executeQuery<{ count: number }>(`SELECT COUNT(*) as count FROM transaction_item_customizations WHERE transaction_item_id IN (${placeholders})`, itemIdsForCheck);
          console.log('🔍 [DEBUG] Existing customizations in DB for these items:', existingCustomizations[0]?.count || 0);
          writeDebugLog(JSON.stringify({ location: 'main.ts:3790', message: 'Existing customizations check', data: { itemIds: itemIdsForCheck, existingCount: existingCustomizations[0]?.count || 0 }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
        }
      } else {
        // UUID or receipt number format - match by uuid_transaction_id
        items = await executeQuery<{ id: number }>('SELECT id FROM transaction_items WHERE uuid_transaction_id = ?', [transactionId]);

        // #region agent log
        writeDebugLog(JSON.stringify({ location: 'main.ts:3790', message: 'Items found (UUID)', data: { transactionId, itemsCount: items.length, itemIds: items.map(i => i.id) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
        // #endregion

        // If no items found, try joining with transactions table
        if (items.length === 0) {
          const tx = await executeQueryOne<{ id: number }>(
            'SELECT id FROM transactions WHERE uuid_id = ? OR CAST(receipt_number AS CHAR) = ? OR receipt_number = ? LIMIT 1',
            [transactionId, String(transactionId), transactionId]
          );
          if (tx && tx.id) {
            items = await executeQuery<{ id: number }>('SELECT id FROM transaction_items WHERE transaction_id = ?', [tx.id]);
            // #region agent log
            writeDebugLog(JSON.stringify({ location: 'main.ts:3798', message: 'Items found (fallback)', data: { transactionId, txId: tx.id, itemsCount: items.length }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
            // #endregion
          }
        }
      }

      const allCustomizations: Array<Record<string, unknown>> = [];
      const allOptions: Array<Record<string, unknown>> = [];

      // #region agent log
      console.log('🔍 [DEBUG] Starting to fetch customizations for', items.length, 'items');
      writeDebugLog(JSON.stringify({ location: 'main.ts:3791', message: 'Starting to fetch customizations', data: { transactionId, itemsCount: items.length, itemIds: items.map(i => i.id) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
      // #endregion

      for (const item of items) {
        const itemId = item.id;

        // #region agent log
        console.log('🔍 [DEBUG] Fetching customizations for item:', itemId);
        writeDebugLog(JSON.stringify({ location: 'main.ts:3796', message: 'Fetching customizations for item', data: { itemId, transactionId }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
        // #endregion

        // Get customizations for this item with customization type name from product_customization_types
        // Use LEFT JOIN - if table doesn't exist, will fall back to NULL and use fallback name
        let customizations: Array<Record<string, unknown>> = [];
        try {
          customizations = await executeQuery<Record<string, unknown>>(`
            SELECT 
              tic.id,
              tic.transaction_item_id,
              tic.uuid_transaction_item_id,
              tic.customization_type_id,
              tic.bundle_product_id,
              tic.created_at,
              COALESCE(pct.name, CONCAT('Customization ', tic.customization_type_id)) as customization_type_name
            FROM transaction_item_customizations tic
            LEFT JOIN product_customization_types pct ON tic.customization_type_id = pct.id
            WHERE tic.transaction_item_id = ?
          `, [itemId]);

          // #region agent log
          console.log('🔍 [DEBUG] Customizations found for item', itemId, ':', customizations.length);
          writeDebugLog(JSON.stringify({ location: 'main.ts:3812', message: 'Customizations query result', data: { itemId, customizationsCount: customizations.length, customizations: customizations.map((c: any) => ({ id: c.id, transaction_item_id: c.transaction_item_id, uuid_transaction_item_id: c.uuid_transaction_item_id })) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
          // #endregion
        } catch (error) {
          // #region agent log
          writeDebugLog(JSON.stringify({ location: 'main.ts:3814', message: 'Customizations query error', data: { itemId, error: String(error) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
          // #endregion

          // If product_customization_types table doesn't exist, query without JOIN
          console.warn('⚠️ product_customization_types table not found, using fallback names');
          customizations = await executeQuery<Record<string, unknown>>(`
            SELECT 
              tic.id,
              tic.transaction_item_id,
              tic.uuid_transaction_item_id,
              tic.customization_type_id,
              tic.bundle_product_id,
              tic.created_at,
              CONCAT('Customization ', tic.customization_type_id) as customization_type_name
            FROM transaction_item_customizations tic
            WHERE tic.transaction_item_id = ?
          `, [itemId]);

          // #region agent log
          writeDebugLog(JSON.stringify({ location: 'main.ts:3826', message: 'Customizations query result (fallback)', data: { itemId, customizationsCount: customizations.length }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
          // #endregion
        }

        for (const customization of customizations) {
          allCustomizations.push(customization);

          // Get options for this customization
          const customizationId = typeof customization.id === 'number' ? customization.id : (typeof customization.id === 'string' ? parseInt(String(customization.id), 10) : 0); const options = await executeQuery<Record<string, unknown>>(`
            SELECT 
              id,
              transaction_item_customization_id,
              customization_option_id,
              option_name,
              price_adjustment,
              created_at
            FROM transaction_item_customization_options
            WHERE transaction_item_customization_id = ?
          `, [customizationId]); allOptions.push(...options);
        }
      }

      // #region agent log
      console.log('🔍 [DEBUG] Returning customizations:', allCustomizations.length, 'customizations,', allOptions.length, 'options');
      writeDebugLog(JSON.stringify({ location: 'main.ts:3849', message: 'Returning customizations', data: { transactionId, totalCustomizations: allCustomizations.length, totalOptions: allOptions.length }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
      // #endregion

      return {
        customizations: allCustomizations,
        options: allOptions
      };
    } catch (error) {
      // #region agent log
      writeDebugLog(JSON.stringify({ location: 'main.ts:3890', message: 'Error in electron function', data: { transactionId, error: String(error), errorStack: error instanceof Error ? error.stack : undefined }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }));
      // #endregion
      console.error('Error getting normalized customizations:', error);
      return { customizations: [], options: [] };
    }
  });

  // Upsert transaction item customizations (for downloading from server)
  ipcMain.handle('localdb-upsert-transaction-item-customizations', async (event, rows: RowArray) => {
    if (!Array.isArray(rows) || rows.length === 0) return { success: true, count: 0 };

    try {
      const queries = rows
        .map(row => {
          const getId = () => {
            const val = row.id;
            if (typeof val === 'number') return val;
            if (typeof val === 'string') {
              const num = Number(val);
              return isNaN(num) ? null : num;
            }
            return null;
          };
          const getNumber = (key: string) => {
            const val = row[key];
            if (typeof val === 'number') return val;
            if (typeof val === 'string') {
              const num = Number(val);
              return isNaN(num) ? null : num;
            }
            return null;
          };
          const getString = (key: string) => (typeof row[key] === 'string' ? row[key] as string : null);
          const getDate = (key: string) => {
            const val = row[key];
            if (val instanceof Date) return val;
            if (typeof val === 'string' || typeof val === 'number') return val;
            return null;
          };

          // If id is null/undefined/0, let database auto-generate it
          const rowId = getId();
          const hasId = rowId !== null && rowId !== 0;

          const transactionItemId = getNumber('transaction_item_id'); // transaction_item_id is a numeric foreign key, not a string
          const customizationTypeId = getNumber('customization_type_id');
          const bundleProductId = getNumber('bundle_product_id');
          const createdDate = getDate('created_at');
          const createdAt = createdDate ? toMySQLDateTime(createdDate as string | number | Date) : toMySQLDateTime(new Date());

          // Validate required fields - transaction_item_id cannot be null
          if (transactionItemId === null || transactionItemId === 0) {
            console.warn('⚠️ [TRANSACTION ITEM CUSTOMIZATIONS UPSERT] Skipping row with null/zero transaction_item_id:', {
              rowId,
              customizationTypeId,
              row: JSON.stringify(row).substring(0, 200)
            });
            return null; // Skip this row
          }

          if (customizationTypeId === null || customizationTypeId === 0) {
            console.warn('⚠️ [TRANSACTION ITEM CUSTOMIZATIONS UPSERT] Skipping row with null/zero customization_type_id:', {
              rowId,
              transactionItemId,
              row: JSON.stringify(row).substring(0, 200)
            });
            return null; // Skip this row
          }

          if (hasId) {
            return {
              sql: `
              INSERT INTO transaction_item_customizations (
                id, transaction_item_id, customization_type_id, bundle_product_id, created_at
              ) VALUES (?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                transaction_item_id = VALUES(transaction_item_id),
                customization_type_id = VALUES(customization_type_id),
                bundle_product_id = VALUES(bundle_product_id),
                created_at = VALUES(created_at)
            `,
              params: [
                rowId,
                transactionItemId,
                customizationTypeId,
                bundleProductId,
                createdAt
              ] as (string | number | null | boolean)[]
            };
          } else {
            // Auto-generate ID
            return {
              sql: `
              INSERT INTO transaction_item_customizations (
                transaction_item_id, customization_type_id, bundle_product_id, created_at
              ) VALUES (?, ?, ?, ?)
            `,
              params: [
                transactionItemId,
                customizationTypeId,
                bundleProductId,
                createdAt
              ] as (string | number | null | boolean)[]
            };
          }
        })
        .filter((query): query is { sql: string; params: (string | number | null | boolean)[] } => query !== null); // Remove null entries (invalid rows)

      if (queries.length === 0) {
        console.warn('⚠️ [TRANSACTION ITEM CUSTOMIZATIONS UPSERT] No valid rows to insert after filtering');
        return { success: true, count: 0 };
      }

      await executeTransaction(queries);
      return { success: true, count: queries.length };
    } catch (error) {
      console.error('Error upserting transaction item customizations:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Upsert transaction item customization options (for downloading from server)
  ipcMain.handle('localdb-upsert-transaction-item-customization-options', async (event, rows: RowArray) => {
    if (!Array.isArray(rows) || rows.length === 0) return { success: true, count: 0 };

    try {
      const queries = rows.map(row => {
        const getId = () => {
          const val = row.id;
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getNumber = (key: string) => {
          const val = row[key];
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getString = (key: string) => (typeof row[key] === 'string' ? row[key] as string : null);
        const getDate = (key: string) => {
          const val = row[key];
          if (val instanceof Date) return val;
          if (typeof val === 'string' || typeof val === 'number') return val;
          return null;
        };

        // If id is null/undefined/0, let database auto-generate it
        const rowId = getId();
        const hasId = rowId !== null && rowId !== 0;

        const transactionItemCustomizationId = getNumber('transaction_item_customization_id');
        const customizationOptionId = getNumber('customization_option_id');
        const optionName = getString('option_name');
        const priceAdjustment = getNumber('price_adjustment') ?? 0;
        const createdDate = getDate('created_at');
        const createdAt = createdDate ? toMySQLDateTime(createdDate as string | number | Date) : toMySQLDateTime(new Date());

        if (hasId) {
          return {
            sql: `
              INSERT INTO transaction_item_customization_options (
                id, transaction_item_customization_id, customization_option_id, 
                option_name, price_adjustment, created_at
              ) VALUES (?, ?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                transaction_item_customization_id = VALUES(transaction_item_customization_id),
                customization_option_id = VALUES(customization_option_id),
                option_name = VALUES(option_name),
                price_adjustment = VALUES(price_adjustment),
                created_at = VALUES(created_at)
            `,
            params: [
              rowId,
              transactionItemCustomizationId,
              customizationOptionId,
              optionName,
              priceAdjustment,
              createdAt
            ] as (string | number | null | boolean)[]
          };
        } else {
          // Auto-generate ID
          return {
            sql: `
              INSERT INTO transaction_item_customization_options (
                transaction_item_customization_id, customization_option_id, 
                option_name, price_adjustment, created_at
              ) VALUES (?, ?, ?, ?, ?)
            `,
            params: [
              transactionItemCustomizationId,
              customizationOptionId,
              optionName,
              priceAdjustment,
              createdAt
            ] as (string | number | null | boolean)[]
          };
        }
      });

      await executeTransaction(queries);
      return { success: true, count: rows.length };
    } catch (error) {
      console.error('Error upserting transaction item customization options:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('localdb-get-transaction-refunds', async (event, transactionUuid: string) => {
    try {
      return await executeQuery(`
        SELECT *
        FROM transaction_refunds
        WHERE transaction_uuid = ?
        ORDER BY refunded_at DESC, id DESC
      `, [transactionUuid]);
    } catch (error) {
      console.error('Error getting transaction refunds:', error);
      return [];
    }
  });

  /** Waiters Performance Report: aggregated metrics per waiter for completed transactions in date range.
   * Excludes cancelled items, deducts refunds proportionally from revenue.
   * Returns: waiters (waiter_id, waiter_name, color, total_items_sold, total_revenue, transaction_count, avg_transaction_value, top_products). */
  ipcMain.handle('localdb-get-waiter-performance-report', async (
    _event,
    payload: { businessId: number; startDate: string; endDate: string }
  ) => {
    try {
      await ensureTransactionItemsWaiterIdColumn();
      const { businessId, startDate, endDate } = payload || {};
      if (!businessId) {
        return { waiters: [], topProductsLimit: 5 };
      }

      const startIso = startDate ? (startDate.includes('T') ? startDate : `${startDate}T00:00:00`) : null;
      const endIso = endDate ? (endDate.includes('T') ? endDate : `${endDate}T23:59:59`) : null;

      // 1. Get all completed transactions in date range for this business
      let txQuery = `
        SELECT t.uuid_id, t.id as tx_int_id, t.final_amount, t.created_at
        FROM transactions t
        WHERE t.business_id = ? AND t.status = 'completed'
      `;
      const txParams: (string | number)[] = [businessId];
      if (startIso != null) {
        txQuery += ' AND t.created_at >= ?';
        txParams.push(toMySQLDateTime(startIso) ?? '');
      }
      if (endIso != null) {
        txQuery += ' AND t.created_at <= ?';
        txParams.push(toMySQLDateTime(endIso) ?? '');
      }

      const transactions = await executeQuery<{ uuid_id: string; tx_int_id: number; final_amount: number; created_at: string }>(txQuery, txParams);
      if (transactions.length === 0) {
        return { waiters: [], topProductsLimit: 5 };
      }

      const txUuids = transactions.map(t => t.uuid_id);
      const txById = new Map(transactions.map(t => [t.uuid_id, t]));

      // 2. Get refund total per transaction
      const placeholders = txUuids.map(() => '?').join(',');
      const refundRows = await executeQuery<{ transaction_uuid: string; total_refund: number }>(
        `SELECT transaction_uuid, SUM(refund_amount) as total_refund
         FROM transaction_refunds
         WHERE transaction_uuid IN (${placeholders}) AND status IN ('pending', 'completed')
         GROUP BY transaction_uuid`,
        txUuids
      );
      const refundByTx = new Map<string, number>();
      for (const r of refundRows) {
        refundByTx.set(r.transaction_uuid, Number(r.total_refund) || 0);
      }

      // 3. Compute per-transaction total (all non-cancelled items) for refund proportion
      const txTotalQuery = `
        SELECT ti.uuid_transaction_id, COALESCE(SUM(ti.total_price), 0) as items_total
        FROM transaction_items ti
        WHERE ti.uuid_transaction_id IN (${placeholders})
          AND (ti.production_status IS NULL OR ti.production_status != 'cancelled')
        GROUP BY ti.uuid_transaction_id
      `;
      const txTotalRows = await executeQuery<{ uuid_transaction_id: string; items_total: number }>(txTotalQuery, txUuids);
      const txItemsTotal = new Map<string, number>();
      for (const r of txTotalRows) {
        txItemsTotal.set(r.uuid_transaction_id, Number(r.items_total) || 0);
      }

      // 4. Get items: waiter_id, transaction_uuid, product_id, quantity, total_price (exclude cancelled)
      const itemsQuery = `
        SELECT ti.waiter_id, ti.uuid_transaction_id, ti.product_id, ti.quantity, ti.total_price, COALESCE(p.nama, 'Unknown') as product_name
        FROM transaction_items ti
        LEFT JOIN products p ON ti.product_id = p.id
        INNER JOIN transactions t ON ti.uuid_transaction_id = t.uuid_id AND t.id = ti.transaction_id
        WHERE ti.uuid_transaction_id IN (${placeholders})
          AND (ti.production_status IS NULL OR ti.production_status != 'cancelled')
          AND ti.waiter_id IS NOT NULL
      `;
      const items = await executeQuery<{
        waiter_id: number;
        uuid_transaction_id: string;
        product_id: number;
        quantity: number;
        total_price: number;
        product_name: string;
      }>(itemsQuery, txUuids);

      // 5. Aggregate per waiter (items only - waiter items)
      type WaiterAgg = {
        waiter_id: number;
        total_items_sold: number;
        gross_revenue: number;
        transaction_ids: Set<string>;
        products: Map<number, { product_name: string; quantity: number; revenue: number }>;
      };
      const waiterAgg = new Map<number, WaiterAgg>();

      for (const it of items) {
        const wid = it.waiter_id;
        if (!waiterAgg.has(wid)) {
          waiterAgg.set(wid, {
            waiter_id: wid,
            total_items_sold: 0,
            gross_revenue: 0,
            transaction_ids: new Set(),
            products: new Map(),
          });
        }
        const agg = waiterAgg.get(wid)!;
        agg.total_items_sold += Number(it.quantity) || 0;
        const rev = Number(it.total_price) || 0;
        agg.gross_revenue += rev;
        agg.transaction_ids.add(it.uuid_transaction_id);

        const pid = it.product_id;
        if (!agg.products.has(pid)) {
          agg.products.set(pid, { product_name: it.product_name, quantity: 0, revenue: 0 });
        }
        const prod = agg.products.get(pid)!;
        prod.quantity += Number(it.quantity) || 0;
        prod.revenue += rev;
      }

      // 6. Deduct proportional refunds per waiter per transaction (waiter's share of items * refund)
      for (const [wid, agg] of waiterAgg) {
        let totalRefundDeduction = 0;
        for (const txUuid of agg.transaction_ids) {
          const tx = txById.get(txUuid);
          const refund = refundByTx.get(txUuid) || 0;
          if (!tx || refund <= 0) continue;
          const txTotal = txItemsTotal.get(txUuid) || 1;
          const waiterShare = agg.gross_revenue > 0 ? 1 : 0;
          // Proportional: waiter's share of this tx's items / tx total items * refund
          let waiterTxRevenue = 0;
          for (const it of items) {
            if (it.waiter_id === wid && it.uuid_transaction_id === txUuid) {
              waiterTxRevenue += Number(it.total_price) || 0;
            }
          }
          const proportion = txTotal > 0 ? waiterTxRevenue / txTotal : 0;
          totalRefundDeduction += proportion * refund;
        }
        (agg as WaiterAgg & { net_revenue: number }).net_revenue = Math.max(0, agg.gross_revenue - totalRefundDeduction);
      }

      // 7. Get employee names and colors
      const waiterIds = Array.from(waiterAgg.keys());
      const empPlaceholders = waiterIds.map(() => '?').join(',');
      const employees = await executeQuery<{ id: number; nama_karyawan: string; color: string | null }>(
        `SELECT id, nama_karyawan, color FROM employees WHERE id IN (${empPlaceholders})`,
        waiterIds
      );
      const empMap = new Map(employees.map(e => [e.id, { name: e.nama_karyawan, color: e.color }]));

      // 8. Build result: sort by net_revenue desc, add rank and top products
      const TOP_PRODUCTS_LIMIT = 5;
      const waitersResult: Array<{
        waiter_id: number;
        waiter_name: string;
        color: string | null;
        total_items_sold: number;
        total_revenue: number;
        transaction_count: number;
        avg_transaction_value: number;
        rank: number;
        top_products: Array<{ product_id: number; product_name: string; total_quantity: number; total_revenue: number }>;
      }> = [];

      const sorted = Array.from(waiterAgg.entries())
        .map(([wid, a]) => ({
          wid,
          ...a,
          net_revenue: (a as WaiterAgg & { net_revenue?: number }).net_revenue ?? a.gross_revenue,
        }))
        .sort((a, b) => b.net_revenue - a.net_revenue);

      sorted.forEach((w, idx) => {
        const emp = empMap.get(w.wid);
        const topProducts = Array.from(w.products.entries())
          .map(([pid, p]) => ({ product_id: pid, ...p, total_quantity: p.quantity, total_revenue: p.revenue }))
          .sort((a, b) => b.total_revenue - a.total_revenue)
          .slice(0, TOP_PRODUCTS_LIMIT);

        waitersResult.push({
          waiter_id: w.wid,
          waiter_name: emp?.name ?? `Waiter #${w.wid}`,
          color: emp?.color ?? null,
          total_items_sold: w.total_items_sold,
          total_revenue: w.net_revenue,
          transaction_count: w.transaction_ids.size,
          avg_transaction_value: w.transaction_ids.size > 0 ? w.net_revenue / w.transaction_ids.size : 0,
          rank: idx + 1,
          top_products: topProducts,
        });
      });

      return { waiters: waitersResult, topProductsLimit: TOP_PRODUCTS_LIMIT };
    } catch (error) {
      console.error('Error getting waiter performance report:', error);
      return { waiters: [], topProductsLimit: 5 };
    }
  });

  // --- System POS localdb handlers (read from system_pos MySQL DB for "Daftar Transaksi" system-pos mode) ---
  ipcMain.handle('localdb-get-system-pos-transactions', async (event, businessId?: number, limit?: number) => {
    try {
      await ensureSystemPosSchema();
      let query = `
        SELECT
          t.*,

          t.final_amount,
          t.total_amount,
          t.id,
          t.receipt_number,
          COALESCE(
            NULLIF(t.refund_total, 0),
            COALESCE(refund_summary.total_refund, 0)
          ) as refund_total,
          CASE 
            WHEN COALESCE(refund_summary.total_refund, t.refund_total, 0) > 0 THEN
              CASE 
                WHEN COALESCE(refund_summary.total_refund, t.refund_total, 0) >= (t.final_amount - 0.01) THEN 'full'
                ELSE 'partial'
              END
            ELSE 'none'
          END as refund_status
        FROM transactions t
        LEFT JOIN (
          SELECT 
            uuid_transaction_id,
            SUM(total_price) as total_cancelled
          FROM transaction_items
          WHERE production_status = 'cancelled'
          GROUP BY uuid_transaction_id
        ) cancelled ON t.uuid_id = cancelled.uuid_transaction_id
        LEFT JOIN (
          SELECT 
            transaction_uuid,
            SUM(refund_amount) as total_refund
          FROM transaction_refunds
          WHERE status IN ('pending', 'completed')
          GROUP BY transaction_uuid
        ) refund_summary ON t.uuid_id = refund_summary.transaction_uuid
        WHERE t.status != 'archived'
      `;
      const params: (string | number | null | boolean)[] = [];
      if (businessId != null) {
        query += ' AND t.business_id = ?';
        params.push(businessId);
      }
      query += ' ORDER BY t.created_at DESC';
      if (limit != null && typeof limit === 'number' && limit > 0) {
        const safeLimit = Math.min(Math.max(limit, 1), 100000);
        query += ` LIMIT ${safeLimit}`;
      }
      let results = await executeSystemPosQuery<Record<string, unknown>>(query, params);
      // Enrich with refund totals from main DB (system_pos may not have refunds synced)
      if (results.length > 0) {
        try {
          const uuids = results.map((r: Record<string, unknown>) => {
            const id = r.id ?? r.uuid_id;
            return typeof id === 'string' ? id : String(id);
          }).filter(Boolean);
          if (uuids.length > 0) {
            const placeholders = uuids.map(() => '?').join(',');
            const refundRows = await executeQuery<{ transaction_uuid: string; total_refund: number }>(
              `SELECT transaction_uuid, SUM(refund_amount) as total_refund
               FROM transaction_refunds
               WHERE transaction_uuid IN (${placeholders}) AND status IN ('pending', 'completed')
               GROUP BY transaction_uuid`,
              uuids
            );
            const refundByUuid = new Map<string, number>();
            for (const row of refundRows || []) {
              if (row?.transaction_uuid && (row.total_refund ?? 0) > 0) {
                refundByUuid.set(String(row.transaction_uuid), Number(row.total_refund));
              }
            }
            if (refundByUuid.size > 0) {
              results = results.map((r: Record<string, unknown>) => {
                const uuid = String(r.id ?? r.uuid_id ?? '');
                const mainRefund = refundByUuid.get(uuid);
                if (mainRefund != null && mainRefund > 0) {
                  const finalAmount = typeof r.final_amount === 'number' ? r.final_amount : Number(r.final_amount) || 0;
                  const status = mainRefund >= (finalAmount - 0.01) ? 'full' : 'partial';
                  return { ...r, refund_total: mainRefund, refund_status: status };
                }
                return r;
              }) as Record<string, unknown>[];
            }
          }
        } catch (enrichErr) {
          console.warn('[SYSTEM POS] Failed to enrich refunds from main DB (non-fatal):', enrichErr instanceof Error ? enrichErr.message : String(enrichErr));
        }
      }
      // #region agent log
      try {
        const withRefund = results.filter((r: Record<string, unknown>) => {
          const v = r.refund_total;
          return v != null && (typeof v === 'number' ? v > 0 : Number(v) > 0);
        });
        fetch('http://127.0.0.1:7245/ingest/519de021-d49d-473f-a8a1-4215977c867a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'main.ts:localdb-get-system-pos-transactions', message: 'system_pos transactions refund check', data: { total: results.length, withRefundCount: withRefund.length, sampleRefunds: withRefund.slice(0, 3).map((r: Record<string, unknown>) => ({ id: r.id, refund_total: r.refund_total })) }, hypothesisId: 'H1', runId: 'post-fix', timestamp: Date.now() }) }).catch(() => { });
      } catch (_) { }
      // #endregion
      return results;
    } catch (error) {
      console.error('Error getting system-pos transactions:', error);
      return [];
    }
  });

  ipcMain.handle('localdb-get-system-pos-transaction-items', async (event, transactionId?: number | string) => {
    try {
      await ensureSystemPosSchema();
      if (!transactionId) return [];
      const isNumeric = typeof transactionId === 'number' || (typeof transactionId === 'string' && /^\d+$/.test(String(transactionId).trim()));
      const isReceiptFormat = typeof transactionId === 'string' && /^0\d{15,}$/.test(String(transactionId).trim());
      const useNumeric = isNumeric && !isReceiptFormat;
      let items: Array<Record<string, unknown>> = [];
      if (useNumeric) {
        items = await executeSystemPosQuery<Record<string, unknown>>(`
          SELECT ti.*, p.nama as product_name
          FROM transaction_items ti
          LEFT JOIN products p ON ti.product_id = p.id
          WHERE ti.transaction_id = ?
          ORDER BY ti.id ASC
        `, [transactionId]);
      } else {
        items = await executeSystemPosQuery<Record<string, unknown>>(`
          SELECT ti.*, p.nama as product_name
          FROM transaction_items ti
          LEFT JOIN products p ON ti.product_id = p.id
          WHERE ti.uuid_transaction_id = ?
          ORDER BY ti.id ASC
        `, [transactionId]);
        if (items.length === 0) {
          items = await executeSystemPosQuery<Record<string, unknown>>(`
            SELECT ti.*, p.nama as product_name
            FROM transaction_items ti
            LEFT JOIN products p ON ti.product_id = p.id
            INNER JOIN transactions t ON ti.transaction_id = t.id
            WHERE t.uuid_id = ? OR CAST(t.receipt_number AS CHAR) = ? OR t.receipt_number = ?
            ORDER BY ti.id ASC
          `, [transactionId, String(transactionId), transactionId]);
        }
        if (items.length === 0) {
          const tx = await executeSystemPosQueryOne<{ id: number; uuid_id: string; receipt_number: number | null }>(`
            SELECT id, uuid_id, receipt_number FROM transactions
            WHERE uuid_id = ? OR CAST(receipt_number AS CHAR) = ? OR receipt_number = ? OR id = ?
            LIMIT 1
          `, [transactionId, String(transactionId), transactionId, transactionId]);
          if (tx) {
            if (tx.id != null) {
              items = await executeSystemPosQuery<Record<string, unknown>>(`
                SELECT ti.*, p.nama as product_name
                FROM transaction_items ti
                LEFT JOIN products p ON ti.product_id = p.id
                WHERE ti.transaction_id = ?
                ORDER BY ti.id ASC
              `, [tx.id]);
            }
            if (items.length === 0 && tx.uuid_id) {
              items = await executeSystemPosQuery<Record<string, unknown>>(`
                SELECT ti.*, p.nama as product_name
                FROM transaction_items ti
                LEFT JOIN products p ON ti.product_id = p.id
                WHERE ti.uuid_transaction_id = ?
                ORDER BY ti.id ASC
              `, [tx.uuid_id]);
            }
          }
        }
      }
      return items;
    } catch (error) {
      console.error('Error getting system-pos transaction items:', error);
      return [];
    }
  });

  ipcMain.handle('localdb-get-system-pos-transaction-refunds', async (event, transactionUuid: string) => {
    try {
      await ensureSystemPosSchema();
      return await executeSystemPosQuery<Record<string, unknown>>(`
        SELECT *
        FROM transaction_refunds
        WHERE transaction_uuid = ?
        ORDER BY refunded_at DESC, id DESC
      `, [transactionUuid]);
    } catch (error) {
      console.error('Error getting system-pos transaction refunds:', error);
      return [];
    }
  });

  ipcMain.handle('localdb-get-system-pos-users', async () => {
    try {
      return await executeQuery('SELECT * FROM users ORDER BY name ASC');
    } catch (error) {
      console.error('Error getting system-pos users (from main DB):', error);
      return [];
    }
  });

  ipcMain.handle('localdb-get-system-pos-businesses', async () => {
    try {
      return await executeQuery('SELECT * FROM businesses ORDER BY name ASC');
    } catch (error) {
      console.error('Error getting system-pos businesses (from main DB):', error);
      return [];
    }
  });

  ipcMain.handle('localdb-get-system-pos-all-products', async (event, businessId?: number) => {
    try {
      await ensureSystemPosSchema();
      let query = `SELECT p.id, p.nama FROM products p WHERE 1=1`;
      const params: (number | null)[] = [];
      if (businessId != null) {
        try {
          const hasJunction = await executeSystemPosQueryOne<{ n: number }>(`
            SELECT 1 as n FROM information_schema.tables
            WHERE table_schema = DATABASE() AND table_name = 'product_businesses' LIMIT 1
          `, []);
          if (hasJunction) {
            query += ` AND EXISTS (SELECT 1 FROM product_businesses pb WHERE pb.product_id = p.id AND pb.business_id = ?)`;
            params.push(businessId);
          }
        } catch {
          /* ignore */
        }
      }
      query += ` ORDER BY p.nama ASC`;
      const results = await executeSystemPosQuery<Record<string, unknown>>(query, params);
      return results;
    } catch (error) {
      console.error('Error getting system-pos products:', error);
      return [];
    }
  });

  ipcMain.handle('localdb-get-system-pos-employees', async () => {
    try {
      return await executeQuery('SELECT * FROM employees ORDER BY nama_karyawan ASC');
    } catch (error) {
      console.error('Error getting system-pos employees (from main DB):', error);
      return [];
    }
  });

  ipcMain.handle('localdb-get-shift-refunds', async (event, payload: {
    userId: number;
    businessId: number;
    shiftUuid?: string | null;
    shiftUuids?: string[];
    shiftStart: string;
    shiftEnd?: string | null;
  }) => {
    try {
      const { userId, businessId, shiftUuid, shiftUuids, shiftStart, shiftEnd } = payload;

      let query = `
        SELECT 
          tr.uuid_id as refund_uuid,
          tr.transaction_uuid,
          tr.refund_amount,
          tr.cash_delta,
          tr.refunded_at,
          tr.refunded_by,
          tr.payment_method_id,
          tr.reason,
          tr.note,
          t.uuid_id as transaction_uuid_id,
          t.payment_method,
          t.final_amount,
          t.created_at as transaction_created_at,
          t.customer_name,
          u.email as issuer_email,
          COALESCE(e.nama_karyawan, (
            SELECT e2.nama_karyawan
            FROM transaction_items ti2
            LEFT JOIN employees e2 ON ti2.waiter_id = e2.id
            WHERE ti2.transaction_id = t.id AND ti2.waiter_id IS NOT NULL
            LIMIT 1
          )) as waiter_name
        FROM transaction_refunds tr
        INNER JOIN transactions t ON tr.transaction_uuid = t.uuid_id
        LEFT JOIN users u ON t.user_id = u.id
        LEFT JOIN employees e ON t.waiter_id = e.id
        WHERE tr.business_id = ?
        AND tr.status != 'failed'
      `;
      const params: (string | number | null | boolean)[] = [businessId];

      // Filter by transaction's shift: all refunds for transactions bound to the given shift(s)
      if (shiftUuids && shiftUuids.length > 0) {
        query += ' AND t.shift_uuid IN (' + shiftUuids.map(() => '?').join(',') + ')';
        params.push(...shiftUuids);
      } else if (shiftUuid) {
        query += ' AND t.shift_uuid = ?';
        params.push(shiftUuid);
      } else {
        if (userId !== null) {
          query += ' AND tr.refunded_by = ?';
          params.push(userId);
        }
        query += ' AND tr.refunded_at >= ?';
        params.push(toMySQLDateTime(shiftStart));
        if (shiftEnd) {
          query += ' AND tr.refunded_at <= ?';
          params.push(toMySQLDateTime(shiftEnd));
        }
      }

      query += ' ORDER BY tr.refunded_at DESC';

      return await executeQuery(query, params);
    } catch (error) {
      console.error('Error getting shift refunds:', error);
      return [];
    }
  });

  // Get cancelled items for shift (for Ganti Shift report). Same filters as other shift handlers.
  // Returns: product_name, quantity, unit_price, total_price, cancelled_at, cancelled_by_user_name, cancelled_by_waiter_name, transaction info.
  ipcMain.handle('localdb-get-shift-cancelled-items', async (event, userId: number | null, shiftStart: string, shiftEnd: string | null, businessId: number | null = null, shiftUuid?: string | null, shiftUuids?: string[]) => {
    try {
      if (businessId === null) return [];
      const shiftStartMySQL = toMySQLDateTime(shiftStart);
      const shiftEndMySQL = shiftEnd ? toMySQLDateTime(shiftEnd) : null;

      let query = `
        SELECT 
          ti.uuid_id as item_uuid_id,
          ti.transaction_id,
          ti.uuid_transaction_id,
          ti.product_id,
          COALESCE(p.nama, 'Unknown') as product_name,
          ti.quantity,
          ti.unit_price,
          ti.total_price,
          ti.custom_note,
          ti.cancelled_at,
          ti.cancelled_by_user_id,
          ti.cancelled_by_waiter_id,
          COALESCE(u.name, u.email, 'Tidak diketahui') as cancelled_by_user_name,
          COALESCE(e.nama_karyawan, 'Tidak diketahui') as cancelled_by_waiter_name,
          t.receipt_number,
          t.customer_name
        FROM transaction_items ti
        INNER JOIN transactions t ON ti.transaction_id = t.id
        LEFT JOIN products p ON ti.product_id = p.id
        LEFT JOIN users u ON COALESCE(ti.cancelled_by_user_id, t.user_id) = u.id
        LEFT JOIN employees e ON ti.cancelled_by_waiter_id = e.id
        WHERE t.business_id = ?
        AND t.status = 'completed'
        AND ti.production_status = 'cancelled'
      `;
      const params: (string | number | null | boolean)[] = [businessId];

      if (shiftUuids && shiftUuids.length > 0) {
        query += ' AND t.shift_uuid IN (' + shiftUuids.map(() => '?').join(',') + ')';
        params.push(...shiftUuids);
      } else if (shiftUuid) {
        query += ' AND t.shift_uuid = ?';
        params.push(shiftUuid);
      } else {
        if (userId !== null) {
          query += ' AND t.user_id = ?';
          params.push(userId);
        }
        query += ' AND t.created_at >= ?';
        params.push(shiftStartMySQL);
        if (shiftEnd) {
          query += ' AND t.created_at <= ?';
          params.push(shiftEndMySQL);
        }
      }

      query += ' ORDER BY ti.cancelled_at DESC, ti.id DESC';

      return await executeQuery(query, params);
    } catch (error) {
      console.error('Error getting shift cancelled items:', error);
      return [];
    }
  });

  ipcMain.handle('localdb-upsert-transaction-refunds', async (event, rows: RowArray) => {
    try {
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];

      for (const r of rows) {
        const uuidId = typeof r.uuid_id === 'string' ? r.uuid_id : String(r.uuid_id ?? '');
        const transactionUuid = typeof r.transaction_uuid === 'string' ? r.transaction_uuid : String(r.transaction_uuid ?? '');
        const businessId = typeof r.business_id === 'number' ? r.business_id : (r.business_id ? Number(r.business_id) : null);
        if (!businessId) {
          console.warn('⚠️ [UPSERT-REFUND] Skipping refund - business_id is missing');
          continue; // Skip this refund
        }
        const shiftUuid = typeof r.shift_uuid === 'string' ? r.shift_uuid : (r.shift_uuid ? String(r.shift_uuid) : null);
        const refundedBy = typeof r.refunded_by === 'number' ? r.refunded_by : (r.refunded_by ? Number(r.refunded_by) : 0);
        const refundAmount = typeof r.refund_amount === 'number' ? r.refund_amount : (r.refund_amount ? Number(r.refund_amount) : 0);
        const cashDelta = typeof r.cash_delta === 'number' ? r.cash_delta : (r.cash_delta ? Number(r.cash_delta) : 0);
        const paymentMethodId = typeof r.payment_method_id === 'number' ? r.payment_method_id : (r.payment_method_id ? Number(r.payment_method_id) : 1);
        const reason = typeof r.reason === 'string' ? r.reason : (r.reason ? String(r.reason) : null);
        const note = typeof r.note === 'string' ? r.note : (r.note ? String(r.note) : null);
        const refundType = typeof r.refund_type === 'string' ? r.refund_type : 'full';
        const status = typeof r.status === 'string' ? r.status : 'completed';
        const refundedAt = r.refunded_at ? (typeof r.refunded_at === 'number' || typeof r.refunded_at === 'string' ? r.refunded_at : new Date()) : new Date();
        const createdAt = r.created_at ? (typeof r.created_at === 'number' || typeof r.created_at === 'string' ? r.created_at : new Date()) : new Date();
        const updatedAt = r.updated_at ? (typeof r.updated_at === 'number' ? new Date(r.updated_at) : (typeof r.updated_at === 'string' ? r.updated_at : new Date())) : new Date();
        const syncedAt = r.synced_at ? (typeof r.synced_at === 'number' ? new Date(r.synced_at) : (typeof r.synced_at === 'string' ? r.synced_at : null)) : null;

        queries.push({
          sql: `
            INSERT INTO transaction_refunds (
              uuid_id,
              transaction_uuid,
              business_id,
              shift_uuid,
              refunded_by,
              refund_amount,
              cash_delta,
              payment_method_id,
              reason,
              note,
              refund_type,
              status,
              refunded_at,
              created_at,
              updated_at,
              synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              transaction_uuid = VALUES(transaction_uuid),
              business_id = VALUES(business_id),
              shift_uuid = VALUES(shift_uuid),
              refunded_by = VALUES(refunded_by),
              refund_amount = VALUES(refund_amount),
              cash_delta = VALUES(cash_delta),
              payment_method_id = VALUES(payment_method_id),
              reason = VALUES(reason),
              note = VALUES(note),
              refund_type = VALUES(refund_type),
              status = VALUES(status),
              refunded_at = VALUES(refunded_at),
              created_at = VALUES(created_at),
              updated_at = VALUES(updated_at),
              synced_at = VALUES(synced_at)
          `,
          params: [
            uuidId,
            transactionUuid,
            businessId,
            shiftUuid,
            refundedBy,
            refundAmount,
            cashDelta,
            paymentMethodId,
            reason,
            note,
            refundType,
            status,
            toMySQLDateTime(refundedAt),
            toMySQLDateTime(createdAt),
            toMySQLDateTime(updatedAt),
            syncedAt ? toMySQLDateTime(syncedAt) : null
          ]
        });
      }

      if (queries.length > 0) {
        await executeTransaction(queries);
      }
      return { success: true };
    } catch (error) {
      console.error('Error upserting transaction refunds:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('localdb-apply-transaction-refund', async (event, payload: {
    refund: TransactionRefundRow;
    transactionUpdate?: {
      id: string;
      refund_status?: string | null;
      refund_total?: number | null;
      last_refunded_at?: string | null;
      status?: string | null;
    };
  }) => {
    try {
      const { refund, transactionUpdate } = payload || {};
      if (!refund || !refund.uuid_id) {
        return { success: false, error: 'Invalid refund payload' };
      }
      if (!refund.business_id) {
        return { success: false, error: 'Business ID is required for refund' };
      }

      // Auto-link to active shift if shift_uuid is missing (use business_id only)
      let finalShiftUuid = refund.shift_uuid;
      if (!finalShiftUuid && refund.business_id) {
        try {
          const businessId = typeof refund.business_id === 'number' ? refund.business_id : (refund.business_id ? parseInt(String(refund.business_id), 10) : null);
          if (businessId) {
            const activeShift = await executeQueryOne<{ uuid_id: string }>(`
              SELECT uuid_id 
              FROM shifts 
              WHERE business_id = ? AND status = 'active'
              ORDER BY shift_start ASC 
              LIMIT 1
            `, [businessId]);
            if (activeShift) {
              finalShiftUuid = activeShift.uuid_id;
              console.log(`🔗 [REFUND] Linked refund ${refund.uuid_id} to active shift ${finalShiftUuid}`);
            }
          } else {
            console.warn('⚠️ [REFUND] Skipping shift link - business_id is missing or invalid');
          }
        } catch (e) {
          console.warn('⚠️ [REFUND] Failed to link refund to active shift:', e);
        }
      }

      const refundedAt = toMySQLDateTime(refund.refunded_at ?? new Date());
      const createdAt = toMySQLDateTime(refund.created_at ?? refundedAt);
      const updatedAt = toMySQLDateTime(refund.updated_at ? (typeof refund.updated_at === 'number' ? new Date(refund.updated_at) : refund.updated_at) : new Date());
      const syncedAt = refund.synced_at ? toMySQLDateTime(typeof refund.synced_at === 'number' ? new Date(refund.synced_at) : refund.synced_at) : null;

      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];

      // Check if refund with this UUID already exists to prevent duplicates
      // Since uuid_id doesn't have a UNIQUE constraint, we need to check manually
      const existingRefund = await executeQueryOne<{ id: number }>(
        'SELECT id FROM transaction_refunds WHERE uuid_id = ? LIMIT 1',
        [refund.uuid_id]
      );

      if (existingRefund) {
        // Update existing refund record instead of inserting duplicate
        queries.push({
          sql: `
            UPDATE transaction_refunds
            SET transaction_uuid = ?,
                business_id = ?,
                shift_uuid = ?,
                refunded_by = ?,
                refund_amount = ?,
                cash_delta = ?,
                payment_method_id = ?,
                reason = ?,
                note = ?,
                refund_type = ?,
                status = ?,
                refunded_at = ?,
                updated_at = ?,
                synced_at = ?
            WHERE uuid_id = ?
          `,
          params: [
            refund.transaction_uuid,
            Number(refund.business_id),
            finalShiftUuid ?? null,
            Number(refund.refunded_by ?? 0),
            Number(refund.refund_amount ?? 0),
            Number(refund.cash_delta ?? 0),
            Number(refund.payment_method_id ?? 1),
            refund.reason ?? null,
            refund.note ?? null,
            refund.refund_type ?? 'full',
            refund.status ?? 'completed',
            refundedAt,
            updatedAt,
            syncedAt,
            refund.uuid_id
          ]
        });
      } else {
        // Insert new refund record
        queries.push({
          sql: `
            INSERT INTO transaction_refunds (
              uuid_id,
              transaction_uuid,
              business_id,
              shift_uuid,
              refunded_by,
              refund_amount,
              cash_delta,
              payment_method_id,
              reason,
              note,
              refund_type,
              status,
              refunded_at,
              created_at,
              updated_at,
              synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          params: [
            refund.uuid_id,
            refund.transaction_uuid,
            Number(refund.business_id),
            finalShiftUuid ?? null,
            Number(refund.refunded_by ?? 0),
            Number(refund.refund_amount ?? 0),
            Number(refund.cash_delta ?? 0),
            Number(refund.payment_method_id ?? 1),
            refund.reason ?? null,
            refund.note ?? null,
            refund.refund_type ?? 'full',
            refund.status ?? 'completed',
            refundedAt,
            createdAt,
            updatedAt,
            syncedAt
          ]
        });
      }

      if (transactionUpdate?.id) {
        // Only update transaction if transactionUpdate fields are explicitly provided (not undefined)
        // This prevents overwriting transaction data when syncing refunds that were already applied locally
        const updateFields: string[] = [];
        const updateParams: (string | number | null)[] = [];

        if (transactionUpdate.refund_status !== undefined) {
          updateFields.push('refund_status = ?');
          updateParams.push(transactionUpdate.refund_status ?? null);
        }
        if (transactionUpdate.refund_total !== undefined) {
          updateFields.push('refund_total = ?');
          updateParams.push(typeof transactionUpdate.refund_total === 'number' ? transactionUpdate.refund_total : null);
        }
        if (transactionUpdate.last_refunded_at !== undefined) {
          updateFields.push('last_refunded_at = ?');
          updateParams.push(transactionUpdate.last_refunded_at ?? refundedAt);
        }
        if (transactionUpdate.status !== undefined) {
          updateFields.push('status = ?');
          updateParams.push(transactionUpdate.status ?? null);
        }

        // Only execute UPDATE if there are fields to update
        if (updateFields.length > 0) {
          updateParams.push(transactionUpdate.id);
          queries.push({
            sql: `
              UPDATE transactions
              SET ${updateFields.join(', ')}
              WHERE id = ?
            `,
            params: updateParams
          });
        }
      }

      await executeTransaction(queries);
      // Sync refund to system_pos so Grand Total card shows refund when system_pos mode is on
      try {
        await ensureSystemPosSchema();
        const txExists = await executeSystemPosQueryOne<{ id: number }>(
          'SELECT id FROM transactions WHERE uuid_id = ? LIMIT 1',
          [refund.transaction_uuid]
        );
        if (txExists) {
          const existingRefund = await executeSystemPosQueryOne<{ id: number }>(
            'SELECT id FROM transaction_refunds WHERE uuid_id = ? LIMIT 1',
            [refund.uuid_id]
          );
          if (existingRefund) {
            await executeSystemPosUpdate(
              `UPDATE transaction_refunds SET
                transaction_uuid = ?, business_id = ?, shift_uuid = ?, refunded_by = ?,
                refund_amount = ?, cash_delta = ?, payment_method_id = ?, reason = ?, note = ?,
                refund_type = ?, status = ?, refunded_at = ?, updated_at = ?, synced_at = ?
                WHERE uuid_id = ?`,
              [
                refund.transaction_uuid,
                Number(refund.business_id),
                finalShiftUuid ?? null,
                Number(refund.refunded_by ?? 0),
                Number(refund.refund_amount ?? 0),
                Number(refund.cash_delta ?? 0),
                Number(refund.payment_method_id ?? 1),
                refund.reason ?? null,
                refund.note ?? null,
                refund.refund_type ?? 'full',
                refund.status ?? 'completed',
                refundedAt,
                updatedAt,
                syncedAt,
                refund.uuid_id
              ]
            );
          } else {
            await executeSystemPosUpdate(
              `INSERT INTO transaction_refunds (
                uuid_id, transaction_uuid, business_id, shift_uuid, refunded_by,
                refund_amount, cash_delta, payment_method_id, reason, note,
                refund_type, status, refunded_at, created_at, updated_at, synced_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                refund.uuid_id,
                refund.transaction_uuid,
                Number(refund.business_id),
                finalShiftUuid ?? null,
                Number(refund.refunded_by ?? 0),
                Number(refund.refund_amount ?? 0),
                Number(refund.cash_delta ?? 0),
                Number(refund.payment_method_id ?? 1),
                refund.reason ?? null,
                refund.note ?? null,
                refund.refund_type ?? 'full',
                refund.status ?? 'completed',
                refundedAt,
                createdAt,
                updatedAt,
                syncedAt
              ]
            );
          }
          if (transactionUpdate?.refund_total !== undefined) {
            await executeSystemPosUpdate(
              'UPDATE transactions SET refund_total = ?, refund_status = ? WHERE uuid_id = ?',
              [
                transactionUpdate.refund_total ?? 0,
                transactionUpdate.refund_status ?? 'partial',
                refund.transaction_uuid
              ]
            );
          }
          console.log(`✅ [SYSTEM POS] Synced refund ${refund.uuid_id} to system_pos`);
        }
      } catch (sysPosErr) {
        console.warn('[SYSTEM POS] Failed to sync refund to system_pos (non-fatal):', sysPosErr instanceof Error ? sysPosErr.message : String(sysPosErr));
      }
      return { success: true };
    } catch (error) {
      console.error('Error applying transaction refund:', error);
      return { success: false, error: String(error) };
    }
  });

  // Split bill - Move items from one transaction to another
  ipcMain.handle('localdb-split-bill', async (event, payload: {
    sourceTransactionUuid: string;
    destinationTransactionUuid: string;
    itemIds: (number | string)[];
  }) => {
    try {
      const { sourceTransactionUuid, destinationTransactionUuid, itemIds } = payload || {};

      if (!sourceTransactionUuid || !destinationTransactionUuid || !itemIds || itemIds.length === 0) {
        return { success: false, error: 'Missing required parameters' };
      }

      // Validate source transaction exists and is pending
      const sourceTransaction = await executeQueryOne<{
        id: number;
        uuid_id: string;
        status: string;
        business_id: number;
      }>('SELECT id, uuid_id, status, business_id FROM transactions WHERE uuid_id = ?', [sourceTransactionUuid]);

      if (!sourceTransaction) {
        return { success: false, error: 'Source transaction not found' };
      }

      if (sourceTransaction.status !== 'pending') {
        return { success: false, error: 'Can only split items from pending transactions' };
      }

      // Validate destination transaction exists and is pending
      const destinationTransaction = await executeQueryOne<{
        id: number;
        uuid_id: string;
        status: string;
        business_id: number;
      }>('SELECT id, uuid_id, status, business_id FROM transactions WHERE uuid_id = ?', [destinationTransactionUuid]);

      if (!destinationTransaction) {
        return { success: false, error: 'Destination transaction not found' };
      }

      if (destinationTransaction.status !== 'pending') {
        return { success: false, error: 'Can only move items to pending transactions' };
      }

      if (sourceTransaction.business_id !== destinationTransaction.business_id) {
        return { success: false, error: 'Cannot move items between different businesses' };
      }

      // Validate items exist and belong to source transaction
      const itemIdPlaceholders = itemIds.map(() => '?').join(',');
      const itemIdParams = itemIds.map(id => typeof id === 'number' ? id : parseInt(String(id), 10));

      const itemsToMove = await executeQuery<{
        id: number;
        uuid_id: string;
        transaction_id: number;
        uuid_transaction_id: string;
      }>(`
        SELECT id, uuid_id, transaction_id, uuid_transaction_id
        FROM transaction_items
        WHERE id IN (${itemIdPlaceholders})
        AND uuid_transaction_id = ?
      `, [...itemIdParams, sourceTransactionUuid]);

      if (itemsToMove.length === 0) {
        return { success: false, error: 'No valid items found to move' };
      }

      if (itemsToMove.length !== itemIds.length) {
        return { success: false, error: 'Some items not found or do not belong to source transaction' };
      }

      // Get all item IDs to move
      const itemIdsToMove = itemsToMove.map(item => item.id);
      const itemIdsToMovePlaceholders = itemIdsToMove.map(() => '?').join(',');

      // Start transaction for atomicity
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];

      // Get voucher discounts before moving items
      const sourceTransactionFull = await executeQueryOne<{ voucher_discount: number }>(`
        SELECT COALESCE(voucher_discount, 0) as voucher_discount
        FROM transactions
        WHERE uuid_id = ?
      `, [sourceTransactionUuid]);

      const sourceVoucherDiscount = sourceTransactionFull?.voucher_discount || 0;

      const destTransactionFull = await executeQueryOne<{ voucher_discount: number }>(`
        SELECT COALESCE(voucher_discount, 0) as voucher_discount
        FROM transactions
        WHERE uuid_id = ?
      `, [destinationTransactionUuid]);

      const destVoucherDiscount = destTransactionFull?.voucher_discount || 0;

      // Move items to destination transaction
      queries.push({
        sql: `
          UPDATE transaction_items
          SET transaction_id = ?,
              uuid_transaction_id = ?
          WHERE id IN (${itemIdsToMovePlaceholders})
        `,
        params: [destinationTransaction.id, destinationTransactionUuid, ...itemIdsToMove]
      });

      // Recalculate source transaction totals (will be calculated after items are moved)
      // Use subquery to calculate total from remaining items
      queries.push({
        sql: `
          UPDATE transactions
          SET total_amount = (
              SELECT COALESCE(SUM(total_price), 0)
              FROM transaction_items
              WHERE uuid_transaction_id = ?
            ),
            final_amount = (
              SELECT COALESCE(SUM(total_price), 0)
              FROM transaction_items
              WHERE uuid_transaction_id = ?
            ) - ?,
            status = CASE 
              WHEN (SELECT COUNT(*) FROM transaction_items WHERE uuid_transaction_id = ?) = 0 
              THEN 'cancelled' 
              ELSE status 
            END,
            updated_at = NOW()
          WHERE uuid_id = ?
        `,
        params: [
          sourceTransactionUuid, // For SUM calculation
          sourceTransactionUuid, // For SUM calculation (again)
          sourceVoucherDiscount,
          sourceTransactionUuid, // For COUNT check
          sourceTransactionUuid // For WHERE clause
        ]
      });

      // Recalculate destination transaction totals (will include moved items)
      queries.push({
        sql: `
          UPDATE transactions
          SET total_amount = (
              SELECT COALESCE(SUM(total_price), 0)
              FROM transaction_items
              WHERE uuid_transaction_id = ?
            ),
            final_amount = (
              SELECT COALESCE(SUM(total_price), 0)
              FROM transaction_items
              WHERE uuid_transaction_id = ?
            ) - ?,
            updated_at = NOW()
          WHERE uuid_id = ?
        `,
        params: [
          destinationTransactionUuid, // For SUM calculation
          destinationTransactionUuid, // For SUM calculation (again)
          destVoucherDiscount,
          destinationTransactionUuid // For WHERE clause
        ]
      });

      // Execute all updates in a single transaction (atomic operation)
      await executeTransaction(queries);

      // Check if source transaction was cancelled (for logging)
      const sourceItemCount = await executeQueryOne<{ count: number }>(`
        SELECT COUNT(*) as count
        FROM transaction_items
        WHERE uuid_transaction_id = ?
      `, [sourceTransactionUuid]);

      const hasItemsRemaining = (sourceItemCount?.count || 0) > 0;

      console.log(`✅ [SPLIT BILL] Moved ${itemsToMove.length} item(s) from transaction ${sourceTransactionUuid} to ${destinationTransactionUuid}`);
      if (!hasItemsRemaining) {
        console.log(`ℹ️ [SPLIT BILL] Source transaction ${sourceTransactionUuid} cancelled (all items moved)`);
      }

      return { success: true };
    } catch (error) {
      console.error('Error splitting bill:', error);
      return { success: false, error: String(error) };
    }
  });

  // Mark transactions as synced
  ipcMain.handle('localdb-mark-transactions-synced', async (event, transactionIds: string[]) => {
    if (transactionIds.length === 0) return { success: true };

    try {
      const now = toMySQLDateTime(new Date());
      const placeholders = transactionIds.map(() => '?').join(',');
      // CRITICAL FIX: Use uuid_id instead of id, because smart sync passes UUID strings
      await executeUpdate(
        `UPDATE transactions SET synced_at = ?, sync_status = ?, sync_attempts = 0 WHERE uuid_id IN (${placeholders})`,
        [now, 'synced', ...transactionIds]
      );
      console.log(`✅ [MARK SYNCED] Marked ${transactionIds.length} transaction(s) as synced: ${transactionIds.slice(0, 3).join(', ')}${transactionIds.length > 3 ? '...' : ''}`);
      return { success: true };
    } catch (error) {
      console.error('Error marking transactions as synced:', error);
      return { success: false };
    }
  });

  // Reset transaction sync status (set synced_at to NULL and sync_status to 'pending')
  ipcMain.handle('localdb-reset-transaction-sync', async (event, transactionId: string) => {
    try {
      // CRITICAL FIX: Use uuid_id instead of id, and also reset sync_status to 'pending'
      await executeUpdate('UPDATE transactions SET synced_at = NULL, sync_status = ? WHERE uuid_id = ?', ['pending', transactionId]);
      console.log(`🔄 [RESET SYNC] Transaction ${transactionId} sync status reset to pending`);
      return { success: true };
    } catch (error) {
      console.error('Error resetting transaction sync status:', error);
      return { success: false };
    }
  });

  // ========== SHIFTS IPC HANDLERS ==========

  // Get active shift for a business (with ownership flag)
  ipcMain.handle('localdb-get-active-shift', async (event, userId: number, businessId: number | null = null) => {
    try {
      if (businessId === null) {
        return { success: false, error: 'Business ID is required', shift: null };
      }
      const shift = await executeQueryOne<ShiftRow>(`
        SELECT *
        FROM shifts 
        WHERE business_id = ? AND status = 'active'
        ORDER BY shift_start ASC
        LIMIT 1
      `, [businessId]);

      if (!shift) {
        return { shift: null, isCurrentUserShift: false };
      }

      return {
        shift,
        isCurrentUserShift: Number(shift.user_id) === Number(userId),
      };
    } catch (error) {
      console.error('Error getting active shift:', error);
      return { shift: null, isCurrentUserShift: false };
    }
  });

  // Get shifts history (duplicate handler - already migrated above, removing this duplicate)
  // This handler was already migrated earlier in the file

  // Get all users who have shifts
  ipcMain.handle('localdb-get-shift-users', async (event, businessId: number | null = null) => {
    try {
      if (businessId === null) {
        return [];
      }
      return await executeQuery(`
        SELECT DISTINCT user_id, user_name 
        FROM shifts 
        WHERE business_id = ? 
        ORDER BY user_name
      `, [businessId]);
    } catch (error) {
      console.error('Error getting shift users:', error);
      return [];
    }
  });

  // Create a new shift
  ipcMain.handle('localdb-create-shift', async (event, shiftData: {
    uuid_id: string;
    business_id: number;
    user_id: number;
    user_name: string;
    modal_awal: number;
  }) => {
    try {
      // Validate that business exists (required for foreign key constraint)
      const business = await executeQueryOne<{ id: number }>('SELECT id FROM businesses WHERE id = ? LIMIT 1', [shiftData.business_id]);
      if (!business) {
        console.error(`❌ [SHIFTS] Business ID ${shiftData.business_id} not found in local database`);
        return {
          success: false,
          error: `Business ID ${shiftData.business_id} tidak ditemukan di database lokal. Silakan sinkronkan data dari server terlebih dahulu.`
        };
      }

      // Validate that user exists (required for foreign key constraint)
      const user = await executeQueryOne<{ id: number }>('SELECT id FROM users WHERE id = ? LIMIT 1', [shiftData.user_id]);
      if (!user) {
        console.error(`❌ [SHIFTS] User ID ${shiftData.user_id} not found in local database`);
        return {
          success: false,
          error: `User ID ${shiftData.user_id} tidak ditemukan di database lokal. Silakan sinkronkan data dari server terlebih dahulu.`
        };
      }

      // Ensure there is no other active shift for the business
      const existingShift = await executeQueryOne<ShiftRow>(`
        SELECT id, user_id, user_name, shift_start
        FROM shifts
        WHERE business_id = ? AND status = 'active'
        ORDER BY shift_start ASC
        LIMIT 1
      `, [shiftData.business_id]);

      if (existingShift) {
        return { success: false, error: 'ACTIVE_SHIFT_EXISTS', activeShift: existingShift };
      }

      const now = new Date();
      const nowMySQL = toMySQLDateTime(now);
      await executeUpdate(`
        INSERT INTO shifts (
          uuid_id, business_id, user_id, user_name, shift_start, 
          modal_awal, status, created_at, updated_at, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL)
      `, [
        shiftData.uuid_id ?? null,
        shiftData.business_id ?? null,
        shiftData.user_id ?? null,
        shiftData.user_name ?? null,
        nowMySQL,
        shiftData.modal_awal ?? null,
        nowMySQL,
        Date.now()
      ]);

      console.log(`✅ [SHIFTS] Created shift ${shiftData.uuid_id} for user ${shiftData.user_id}`);
      return { success: true };
    } catch (error) {
      console.error('Error creating shift:', error);
      const errorMessage = String(error);
      // Provide more helpful error message for foreign key constraint failures
      if (errorMessage.includes('FOREIGN KEY constraint failed') || errorMessage.includes('foreign key constraint')) {
        return {
          success: false,
          error: 'Data business atau user tidak ditemukan di database lokal. Silakan sinkronkan data dari server terlebih dahulu sebelum memulai shift.'
        };
      }
      return { success: false, error: errorMessage };
    }
  });

  // End a shift
  ipcMain.handle('localdb-end-shift', async (event, payload: { shiftId: number; kasAkhir?: number | null }) => {
    try {
      const { shiftId, kasAkhir } = payload || {};
      if (!shiftId) {
        return { success: false, error: 'Shift ID is required' };
      }

      const shiftRow = await executeQueryOne<{
        id: number;
        business_id: number;
        user_id: number;
        shift_start: string;
        modal_awal: number;
        status: string;
        uuid_id?: string;
      }>(`SELECT * FROM shifts WHERE id = ?`, [shiftId]);

      if (!shiftRow) {
        return { success: false, error: 'Shift not found' };
      }

      if (shiftRow.status !== 'active') {
        return { success: false, error: 'Shift already ended' };
      }

      const now = toMySQLDateTime(new Date());
      const cashMethod = await executeQueryOne<{ id: number }>('SELECT id FROM payment_methods WHERE code = ? LIMIT 1', ['cash']);
      const cashMethodId = cashMethod?.id || 1;

      const shiftSalesResult = await executeQueryOne<{ cash_total: number }>(`
        SELECT COALESCE(SUM(t.final_amount), 0) as cash_total
        FROM transactions t
        WHERE business_id = ?
          AND user_id = ?
          AND created_at >= ?
          AND created_at <= ?
          AND payment_method_id = ?
          AND status = 'completed'
      `, [
        shiftRow.business_id,
        shiftRow.user_id,
        shiftRow.shift_start,
        toMySQLDateTime(now),
        cashMethodId
      ]);

      const shiftRefundResult = await executeQueryOne<{ refund_total: number }>(`
        SELECT COALESCE(SUM(refund_amount), 0) as refund_total
        FROM transaction_refunds
        WHERE business_id = ?
          AND refunded_by = ?
          AND refunded_at >= ?
          AND refunded_at <= ?
          AND status != 'failed'
      `, [
        shiftRow.business_id,
        shiftRow.user_id,
        shiftRow.shift_start,
        toMySQLDateTime(now)
      ]);

      const cashSalesTotal = shiftSalesResult?.cash_total || 0;
      const cashRefundTotal = shiftRefundResult?.refund_total || 0;
      const kasExpected = Number((Number(shiftRow.modal_awal || 0) + cashSalesTotal - cashRefundTotal).toFixed(2));

      let kasAkhirValue = kasAkhir !== undefined && kasAkhir !== null ? Number(kasAkhir) : null;
      if (kasAkhirValue !== null && Number.isNaN(kasAkhirValue)) {
        kasAkhirValue = null;
      }

      let kasSelisih: number | null = null;
      let kasSelisihLabel: 'balanced' | 'plus' | 'minus' = 'balanced';
      if (kasAkhirValue !== null) {
        kasSelisih = Number((kasAkhirValue - kasExpected).toFixed(2));
        if (Math.abs(kasSelisih) < 0.01) {
          kasSelisih = 0;
          kasSelisihLabel = 'balanced';
        } else {
          kasSelisihLabel = kasSelisih > 0 ? 'plus' : 'minus';
        }
      }

      const affectedRows = await executeUpdate(`
        UPDATE shifts 
        SET shift_end = ?, 
            status = 'completed', 
            updated_at = ?,
            kas_akhir = ?,
            kas_expected = ?,
            kas_selisih = ?,
            kas_selisih_label = ?,
            cash_sales_total = ?,
            cash_refund_total = ?
        WHERE id = ? AND status = 'active'
      `, [
        now,
        Date.now(),
        kasAkhirValue,
        kasExpected,
        kasSelisih,
        kasSelisihLabel,
        cashSalesTotal,
        cashRefundTotal,
        shiftId
      ]);

      if (affectedRows === 0) {
        return { success: false, error: 'Shift not found or already ended' };
      }

      console.log(`✅ [SHIFTS] Ended shift ${shiftId}`);
      return {
        success: true,
        cashSummary: {
          kas_mulai: shiftRow.modal_awal || 0,
          kas_expected: kasExpected,
          kas_akhir: kasAkhirValue,
          cash_sales: cashSalesTotal,
          cash_refunds: cashRefundTotal,
          variance: kasSelisih,
          variance_label: kasSelisihLabel
        }
      };
    } catch (error) {
      console.error('Error ending shift:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get shift statistics
  // When shiftUuids (non-empty array) is provided: count all transactions bound to any of those shifts (whole day).
  // When shiftUuid is provided: count all transactions bound to that shift (single shift tab). Ignores userId.
  ipcMain.handle('localdb-get-shift-statistics', async (event, userId: number | null, shiftStart: string, shiftEnd: string | null, businessId: number | null = null, shiftUuid?: string | null, shiftUuids?: string[]) => {
    try {
      if (businessId === null) {
        return { success: false, error: 'Business ID is required' };
      }
      const shiftStartMySQL = toMySQLDateTime(shiftStart);
      const shiftEndMySQL = shiftEnd ? toMySQLDateTime(shiftEnd) : null;
      let statsQuery = `
        SELECT 
          COUNT(*) as order_count,
          COALESCE(SUM(t.final_amount - COALESCE(cancelled.total_cancelled, 0)), 0) as total_amount,
          COALESCE(SUM(
            CASE 
              WHEN voucher_type = 'free' THEN (t.total_amount - COALESCE(cancelled.total_cancelled, 0))
              ELSE COALESCE(voucher_discount, 0)
            END
          ), 0) as total_discount,
          COALESCE(SUM(
            CASE 
              WHEN (voucher_discount IS NOT NULL AND voucher_discount > 0) OR voucher_type = 'free' THEN 1 
              ELSE 0 
            END
          ), 0) as voucher_count,
          COALESCE(SUM(COALESCE(customer_unit, 0)), 0) as total_cu
        FROM transactions t
        LEFT JOIN (
          SELECT 
            transaction_id, 
            uuid_transaction_id,
            SUM(total_price) as total_cancelled
          FROM transaction_items
          WHERE production_status = 'cancelled'
          GROUP BY uuid_transaction_id, transaction_id
        ) cancelled ON (t.uuid_id = cancelled.uuid_transaction_id OR t.id = cancelled.transaction_id)
        WHERE business_id = ?
        AND status = 'completed'
      `;
      const statsParams: (string | number | null | boolean)[] = [businessId];

      if (shiftUuids && shiftUuids.length > 0) {
        statsQuery += ' AND shift_uuid IN (' + shiftUuids.map(() => '?').join(',') + ')';
        statsParams.push(...shiftUuids);
      } else if (shiftUuid) {
        statsQuery += ' AND shift_uuid = ?';
        statsParams.push(shiftUuid);
      } else {
        if (userId !== null) {
          statsQuery += ' AND user_id = ?';
          statsParams.push(userId);
        }
        statsQuery += ' AND created_at >= ?';
        statsParams.push(shiftStartMySQL);
        if (shiftEnd) {
          statsQuery += ' AND created_at <= ?';
          statsParams.push(shiftEndMySQL);
        }
      }

      const statsResult = await executeQueryOne<{
        order_count: number;
        total_amount: number;
        total_discount: number;
        voucher_count: number;
        total_cu: number;
      }>(statsQuery, statsParams);

      // Get total refunds for transactions in this shift (to subtract from Total Omset)
      let refundQuery = `
        SELECT COALESCE(SUM(tr.refund_amount), 0) as refund_total
        FROM transaction_refunds tr
        INNER JOIN transactions t ON tr.transaction_uuid = t.uuid_id
        WHERE t.business_id = ? AND t.status = 'completed'
        AND (tr.status IS NULL OR tr.status != 'failed')
      `;
      const refundParams: (string | number | null | boolean)[] = [businessId];
      if (shiftUuids && shiftUuids.length > 0) {
        refundQuery += ' AND t.shift_uuid IN (' + shiftUuids.map(() => '?').join(',') + ')';
        refundParams.push(...shiftUuids);
      } else if (shiftUuid) {
        refundQuery += ' AND t.shift_uuid = ?';
        refundParams.push(shiftUuid);
      } else {
        if (userId !== null) {
          refundQuery += ' AND t.user_id = ?';
          refundParams.push(userId);
        }
        refundQuery += ' AND t.created_at >= ?';
        refundParams.push(shiftStartMySQL);
        if (shiftEnd) {
          refundQuery += ' AND t.created_at <= ?';
          refundParams.push(shiftEndMySQL);
        }
      }
      const refundResult = await executeQueryOne<{ refund_total: number }>(refundQuery, refundParams);
      const refundTotal = refundResult?.refund_total ?? 0;
      const netTotalAmount = Math.max(0, (statsResult?.total_amount ?? 0) - refundTotal);

      return {
        order_count: statsResult?.order_count || 0,
        total_amount: netTotalAmount,
        total_discount: statsResult?.total_discount || 0,
        voucher_count: statsResult?.voucher_count || 0,
        total_cu: statsResult?.total_cu ?? 0
      };
    } catch (error) {
      console.error('Error getting shift statistics:', error);
      return {
        order_count: 0,
        total_amount: 0,
        total_discount: 0,
        voucher_count: 0,
        total_cu: 0
      };
    }
  });

  // Get voucher breakdown by type
  // When shiftUuids (non-empty): filter by shift_uuid IN (...). When shiftUuid: filter by shift_uuid = ?. Else: userId + time.
  ipcMain.handle('localdb-get-voucher-breakdown', async (event, userId: number | null, shiftStart: string, shiftEnd: string | null, businessId: number | null = null, shiftUuid?: string | null, shiftUuids?: string[]) => {
    const empty: Record<string, { count: number; total: number }> = {};
    try {
      if (businessId === null) {
        return empty;
      }
      const shiftStartMySQL = toMySQLDateTime(shiftStart);
      const shiftEndMySQL = shiftEnd ? toMySQLDateTime(shiftEnd) : null;

      let query = `
        SELECT 
          COALESCE(voucher_type, 'none') as voucher_type,
          voucher_value,
          COUNT(*) as cnt,
          COALESCE(SUM(
            CASE 
              WHEN COALESCE(voucher_type, 'none') = 'free' THEN total_amount
              ELSE COALESCE(voucher_discount, 0)
            END
          ), 0) as total
        FROM transactions
        WHERE business_id = ?
        AND status = 'completed'
        AND ((voucher_discount IS NOT NULL AND voucher_discount > 0) OR COALESCE(voucher_type, 'none') = 'free')
      `;
      const params: (string | number | null)[] = [businessId];

      if (shiftUuids && shiftUuids.length > 0) {
        query += ' AND shift_uuid IN (' + shiftUuids.map(() => '?').join(',') + ')';
        params.push(...shiftUuids);
      } else if (shiftUuid) {
        query += ' AND shift_uuid = ?';
        params.push(shiftUuid);
      } else {
        if (userId !== null) {
          query += ' AND user_id = ?';
          params.push(userId);
        }
        query += ' AND created_at >= ?';
        params.push(shiftStartMySQL);
        if (shiftEnd) {
          query += ' AND created_at <= ?';
          params.push(shiftEndMySQL);
        }
      }
      query += ' GROUP BY voucher_type, voucher_value';

      const rows = await executeQuery<{ voucher_type: string; voucher_value: number | null; cnt: number; total: number }>(query, params);
      const out: Record<string, { count: number; total: number }> = {};
      const percentKeys = [10, 15, 20, 25, 30, 35, 50] as const;

      for (const r of rows || []) {
        const count = Number(r.cnt) || 0;
        const total = Number(r.total) || 0;
        const vt = String(r.voucher_type || '').toLowerCase();
        const vv = r.voucher_value != null ? Number(r.voucher_value) : null;

        if (vt === 'percent' && vv != null && percentKeys.includes(vv as typeof percentKeys[number])) {
          const key = `percent_${vv}`;
          const cur = out[key] || { count: 0, total: 0 };
          out[key] = { count: cur.count + count, total: cur.total + total };
        } else if (vt === 'nominal') {
          const cur = out['custom'] || { count: 0, total: 0 };
          out['custom'] = { count: cur.count + count, total: cur.total + total };
        } else if (vt === 'free') {
          const cur = out['free'] || { count: 0, total: 0 };
          out['free'] = { count: cur.count + count, total: cur.total + total };
        }
      }
      return out;
    } catch (error) {
      console.error('Error getting voucher breakdown:', error);
      return empty;
    }
  });

  // Get payment method breakdown
  // When shiftUuids (non-empty): all transactions bound to any of those shifts (whole day). When shiftUuid: single shift (all users). Else: userId + time.
  ipcMain.handle('localdb-get-payment-breakdown', async (event, userId: number | null, shiftStart: string, shiftEnd: string | null, businessId: number | null = null, shiftUuid: string | null = null, shiftUuids?: string[]) => {
    try {
      if (businessId === null) {
        return [];
      }

      // Payment breakdown: gross amount per method (minus refund only). Item dibatalkan deduction is centralised in Ringkasan.
      const onlyTxWithItems = ' AND t.id IN (SELECT transaction_id FROM transaction_items GROUP BY transaction_id HAVING COALESCE(SUM(total_price), 0) > 0)';
      if (shiftUuids && shiftUuids.length > 0) {
        const query = `
          SELECT 
            COALESCE(pm.name, 'Unknown') as payment_method_name,
            COALESCE(pm.code, 'unknown') as payment_method_code,
            COUNT(t.id) as transaction_count,
            COALESCE(SUM(GREATEST(0, t.total_amount - COALESCE(t.refund_total, 0))), 0) as total_amount
          FROM transactions t
          LEFT JOIN payment_methods pm ON t.payment_method_id = pm.id
          WHERE t.business_id = ? AND t.shift_uuid IN (${shiftUuids.map(() => '?').join(',')}) AND t.status = 'completed' AND t.refund_status != 'full'${onlyTxWithItems}
          GROUP BY t.payment_method_id, pm.name, pm.code ORDER BY transaction_count DESC
        `;
        const results = await executeQuery(query, [businessId, ...shiftUuids]);
        return results;
      }

      if (shiftUuid) {
        const query = `
          SELECT 
            COALESCE(pm.name, 'Unknown') as payment_method_name,
            COALESCE(pm.code, 'unknown') as payment_method_code,
            COUNT(t.id) as transaction_count,
            COALESCE(SUM(GREATEST(0, t.total_amount - COALESCE(t.refund_total, 0))), 0) as total_amount
          FROM transactions t
          LEFT JOIN payment_methods pm ON t.payment_method_id = pm.id
          WHERE t.business_id = ? AND t.shift_uuid = ? AND t.status = 'completed' AND t.refund_status != 'full'${onlyTxWithItems}
          GROUP BY t.payment_method_id, pm.name, pm.code ORDER BY transaction_count DESC
        `;
        const results = await executeQuery(query, [businessId, shiftUuid]);
        return results;
      }

      // No shift filter: filter by userId (optional) + time range
      const shiftStartMySQL = toMySQLDateTime(shiftStart);
      const shiftEndMySQL = shiftEnd ? toMySQLDateTime(shiftEnd) : null;

      let query = `
        SELECT 
          COALESCE(pm.name, 'Unknown') as payment_method_name,
          COALESCE(pm.code, 'unknown') as payment_method_code,
          COUNT(t.id) as transaction_count,
          COALESCE(SUM(GREATEST(0, t.total_amount - COALESCE(t.refund_total, 0))), 0) as total_amount
        FROM transactions t
        LEFT JOIN payment_methods pm ON t.payment_method_id = pm.id
        WHERE t.business_id = ?
        AND t.created_at >= ?
        AND t.status = 'completed'
        AND t.refund_status != 'full'
        ${onlyTxWithItems}
      `;
      const params: (string | number | null | boolean)[] = [businessId, shiftStartMySQL];

      if (userId !== null) {
        query = query.replace('WHERE t.business_id = ?', 'WHERE t.user_id = ? AND t.business_id = ?');
        params.unshift(userId);
      }

      if (shiftEnd) {
        query += ' AND t.created_at <= ?';
        params.push(shiftEndMySQL);
      }

      query += ' GROUP BY t.payment_method_id, pm.name, pm.code ORDER BY transaction_count DESC';

      const results = await executeQuery(query, params);
      return results;
    } catch (error) {
      console.error('Error getting payment breakdown:', error);
      return [];
    }
  });

  // Get Category I breakdown: only product's category1 (no category2). Refund (full & partial) excluded from amount.
  // When shiftUuids (non-empty): filter by t.shift_uuid IN (...). When shiftUuid: filter by t.shift_uuid = ?. Else: userId + time.
  ipcMain.handle('localdb-get-category1-breakdown', async (event, userId: number | null, shiftStart: string, shiftEnd: string | null, businessId: number | null = null, shiftUuid?: string | null, shiftUuids?: string[]) => {
    try {
      if (businessId === null) {
        return [];
      }
      const shiftStartMySQL = toMySQLDateTime(shiftStart);
      const shiftEndMySQL = shiftEnd ? toMySQLDateTime(shiftEnd) : null;
      let query = `
        SELECT 
          COALESCE(c1.name, 'Unknown') as category1_name,
          COALESCE(c1.id, 0) as category1_id,
          COALESCE(SUM(ti.quantity), 0) as total_quantity,
          COALESCE(SUM(
            ti.total_price / NULLIF((SELECT COALESCE(SUM(ti2.total_price), 0) FROM transaction_items ti2 WHERE ti2.transaction_id = ti.transaction_id AND (ti2.production_status IS NULL OR ti2.production_status != 'cancelled')), 0)
            * COALESCE(GREATEST(0, (t.total_amount - COALESCE(cancelled.total_cancelled, 0)) - COALESCE(t.refund_total, 0)), 0)
          ), 0) as total_amount
        FROM transaction_items ti
        INNER JOIN transactions t ON ti.transaction_id = t.id
        INNER JOIN products p ON ti.product_id = p.id
        LEFT JOIN category1 c1 ON p.category1_id = c1.id
        LEFT JOIN (
            SELECT 
              transaction_id, 
              uuid_transaction_id,
              SUM(total_price) as total_cancelled
            FROM transaction_items
            WHERE production_status = 'cancelled'
            GROUP BY uuid_transaction_id, transaction_id
          ) cancelled ON (t.uuid_id = cancelled.uuid_transaction_id OR t.id = cancelled.transaction_id)
        WHERE t.business_id = ?
        AND t.status = 'completed'
        AND t.refund_status != 'full'
        AND p.category1_id IS NOT NULL
        AND c1.id IS NOT NULL
        AND (ti.production_status IS NULL OR ti.production_status != 'cancelled')
      `;
      const params: (string | number | null | boolean)[] = [businessId];
      if (shiftUuids && shiftUuids.length > 0) {
        query += ' AND t.shift_uuid IN (' + shiftUuids.map(() => '?').join(',') + ')';
        params.push(...shiftUuids);
      } else if (shiftUuid) {
        query += ' AND t.shift_uuid = ?';
        params.push(shiftUuid);
      } else {
        if (userId !== null) {
          query = query.replace('WHERE t.business_id = ?', 'WHERE t.user_id = ? AND t.business_id = ?');
          params.unshift(userId);
        }
        query += ' AND t.created_at >= ?';
        params.push(shiftStartMySQL);
        if (shiftEnd) {
          query += ' AND t.created_at <= ?';
          params.push(shiftEndMySQL);
        }
      }
      query += ' GROUP BY category1_name, c1.id ORDER BY total_amount DESC';
      const results = await executeQuery(query, params);
      return results;
    } catch (error) {
      console.error('Error getting Category I breakdown:', error);
      return [];
    }
  });

  // Get Category II breakdown: only product's category2 that belongs to this business (category2_businesses). Refund (full & partial) excluded from amount.
  // When shiftUuids (non-empty): filter by t.shift_uuid IN (...). When shiftUuid: filter by t.shift_uuid = ?. Else: userId + time.
  ipcMain.handle('localdb-get-category2-breakdown', async (event, userId: number | null, shiftStart: string, shiftEnd: string | null, businessId: number | null = null, shiftUuid?: string | null, shiftUuids?: string[]) => {
    try {
      if (businessId === null) {
        return [];
      }
      const shiftStartMySQL = toMySQLDateTime(shiftStart);
      const shiftEndMySQL = shiftEnd ? toMySQLDateTime(shiftEnd) : null;

      let query = `
        SELECT 
          COALESCE(c2.name, 'Unknown') as category2_name,
          COALESCE(c2.id, 0) as category2_id,
          COALESCE(SUM(ti.quantity), 0) as total_quantity,
          COALESCE(SUM(
            ti.total_price / NULLIF((SELECT COALESCE(SUM(ti2.total_price), 0) FROM transaction_items ti2 WHERE ti2.transaction_id = ti.transaction_id AND (ti2.production_status IS NULL OR ti2.production_status != 'cancelled')), 0)
            * COALESCE(GREATEST(0, (t.total_amount - COALESCE(cancelled.total_cancelled, 0)) - COALESCE(t.refund_total, 0)), 0)
          ), 0) as total_amount
        FROM transaction_items ti
        INNER JOIN transactions t ON ti.transaction_id = t.id
        INNER JOIN products p ON ti.product_id = p.id
        INNER JOIN category2_businesses cb ON cb.category2_id = p.category2_id AND cb.business_id = t.business_id
        LEFT JOIN category2 c2 ON p.category2_id = c2.id
        LEFT JOIN (
            SELECT 
              transaction_id, 
              uuid_transaction_id,
              SUM(total_price) as total_cancelled
            FROM transaction_items
            WHERE production_status = 'cancelled'
            GROUP BY uuid_transaction_id, transaction_id
          ) cancelled ON (t.uuid_id = cancelled.uuid_transaction_id OR t.id = cancelled.transaction_id)
        WHERE t.business_id = ?
        AND t.status = 'completed'
        AND t.refund_status != 'full'
        AND p.category2_id IS NOT NULL
        AND c2.id IS NOT NULL
        AND (ti.production_status IS NULL OR ti.production_status != 'cancelled')
      `;
      const params: (string | number | null | boolean)[] = [businessId];

      if (shiftUuids && shiftUuids.length > 0) {
        query += ' AND t.shift_uuid IN (' + shiftUuids.map(() => '?').join(',') + ')';
        params.push(...shiftUuids);
      } else if (shiftUuid) {
        query += ' AND t.shift_uuid = ?';
        params.push(shiftUuid);
      } else {
        if (userId !== null) {
          query = query.replace('WHERE t.business_id = ?', 'WHERE t.user_id = ? AND t.business_id = ?');
          params.unshift(userId);
        }
        query += ' AND t.created_at >= ?';
        params.push(shiftStartMySQL);
        if (shiftEnd) {
          query += ' AND t.created_at <= ?';
          params.push(shiftEndMySQL);
        }
      }

      query += ' GROUP BY category2_name, c2.id ORDER BY total_amount DESC';
      const results = await executeQuery(query, params);
      return results;
    } catch (error) {
      console.error('Error getting Category II breakdown:', error);
      return [];
    }
  });

  // Get cash summary (shift + whole day)
  // When shiftUuids (non-empty): sum cash for transactions in those shifts (whole day tab). When shiftUuid: single shift. Else: userId + time.
  ipcMain.handle('localdb-get-cash-summary', async (event, userId: number | null, shiftStart: string, shiftEnd: string | null, businessId: number | null = null, shiftUuid?: string | null, shiftUuids?: string[]) => {
    try {
      if (businessId === null) {
        return { success: false, error: 'Business ID is required' };
      }
      const cashMethod = await executeQueryOne<{ id: number }>('SELECT id FROM payment_methods WHERE code = ? LIMIT 1', ['cash']);

      if (!cashMethod) {
        return { cash_shift: 0, cash_whole_day: 0 };
      }

      let shiftQuery = `
        SELECT COALESCE(SUM(t.final_amount - COALESCE(cancelled.total_cancelled, 0)), 0) as cash_total
        FROM transactions t
        LEFT JOIN (
          SELECT 
            transaction_id, 
            uuid_transaction_id,
            SUM(total_price) as total_cancelled
          FROM transaction_items
          WHERE production_status = 'cancelled'
          GROUP BY uuid_transaction_id, transaction_id
        ) cancelled ON (t.uuid_id = cancelled.uuid_transaction_id OR t.id = cancelled.transaction_id)
        WHERE t.business_id = ?
        AND t.payment_method_id = ?
        AND t.status = 'completed'
      `;
      const shiftParams: (string | number | null | boolean)[] = [businessId, cashMethod.id];

      if (shiftUuids && shiftUuids.length > 0) {
        shiftQuery += ' AND t.shift_uuid IN (' + shiftUuids.map(() => '?').join(',') + ')';
        shiftParams.push(...shiftUuids);
      } else if (shiftUuid) {
        shiftQuery += ' AND t.shift_uuid = ?';
        shiftParams.push(shiftUuid);
      } else {
        if (userId !== null) {
          shiftQuery = shiftQuery.replace('WHERE t.business_id = ?', 'WHERE t.user_id = ? AND t.business_id = ?');
          shiftParams.unshift(userId);
        }
        shiftQuery += ' AND t.created_at >= ?';
        shiftParams.push(toMySQLDateTime(shiftStart));
        if (shiftEnd) {
          shiftQuery += ' AND t.created_at <= ?';
          shiftParams.push(toMySQLDateTime(shiftEnd));
        }
      }

      const shiftResult = await executeQueryOne<{ cash_total: number }>(shiftQuery, shiftParams);

      let wholeDayResult: { cash_total: number } | null = null;
      let dayRefundResult: { refund_total: number } | null = null;

      if (shiftUuids && shiftUuids.length > 0) {
        // Whole day tab: shift and whole day are the same set of transactions
        wholeDayResult = shiftResult;
        const refundViaTxQuery = `
          SELECT COALESCE(SUM(tr.refund_amount), 0) as refund_total
          FROM transaction_refunds tr
          INNER JOIN transactions t ON tr.transaction_uuid = t.uuid_id
          WHERE tr.business_id = ? AND tr.status != 'failed'
          AND t.shift_uuid IN (${shiftUuids.map(() => '?').join(',')})
        `;
        dayRefundResult = await executeQueryOne<{ refund_total: number }>(refundViaTxQuery, [businessId, ...shiftUuids]);
      } else {
        const shiftDate = new Date(shiftStart);
        const gmt7Offset = 7 * 60 * 60 * 1000;
        const gmt7Time = new Date(shiftDate.getTime() + gmt7Offset);
        const year = gmt7Time.getUTCFullYear();
        const month = gmt7Time.getUTCMonth();
        const day = gmt7Time.getUTCDate();
        const dayStartGMT7 = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
        const dayEndGMT7 = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
        const dayStart = new Date(dayStartGMT7.getTime() - gmt7Offset);
        const dayEnd = new Date(dayEndGMT7.getTime() - gmt7Offset);

        wholeDayResult = await executeQueryOne<{ cash_total: number }>(`
          SELECT COALESCE(SUM(t.final_amount - COALESCE(cancelled.total_cancelled, 0)), 0) as cash_total
          FROM transactions t
          LEFT JOIN (
            SELECT 
              transaction_id, 
              uuid_transaction_id,
              SUM(total_price) as total_cancelled
            FROM transaction_items
            WHERE production_status = 'cancelled'
            GROUP BY uuid_transaction_id, transaction_id
          ) cancelled ON (t.uuid_id = cancelled.uuid_transaction_id OR t.id = cancelled.transaction_id)
          WHERE t.business_id = ?
          AND t.created_at >= ?
          AND t.created_at <= ?
          AND t.payment_method_id = ?
          AND t.status = 'completed'
        `, [
          businessId,
          toMySQLDateTime(dayStart),
          toMySQLDateTime(dayEnd),
          cashMethod.id
        ]);

        dayRefundResult = await executeQueryOne<{ refund_total: number }>(`
          SELECT COALESCE(SUM(refund_amount), 0) as refund_total
          FROM transaction_refunds
          WHERE business_id = ?
          AND refunded_at >= ?
          AND refunded_at <= ?
          AND status != 'failed'
        `, [
          businessId,
          toMySQLDateTime(dayStart),
          toMySQLDateTime(dayEnd)
        ]);
      }

      // Refund for "shift" scope: when shiftUuid/shiftUuids, use transaction's shift; else time + user
      let refundShiftQuery = `
        SELECT COALESCE(SUM(tr.refund_amount), 0) as refund_total
        FROM transaction_refunds tr
        INNER JOIN transactions t ON tr.transaction_uuid = t.uuid_id
        WHERE tr.business_id = ?
        AND tr.status != 'failed'
      `;
      const refundShiftParams: (string | number | null | boolean)[] = [businessId];

      if (shiftUuids && shiftUuids.length > 0) {
        refundShiftQuery += ' AND t.shift_uuid IN (' + shiftUuids.map(() => '?').join(',') + ')';
        refundShiftParams.push(...shiftUuids);
      } else if (shiftUuid) {
        refundShiftQuery += ' AND t.shift_uuid = ?';
        refundShiftParams.push(shiftUuid);
      } else {
        refundShiftQuery = `
          SELECT COALESCE(SUM(refund_amount), 0) as refund_total
          FROM transaction_refunds
          WHERE business_id = ?
          AND status != 'failed'
        `;
        if (userId !== null) {
          refundShiftParams.push(userId);
          refundShiftQuery += ' AND refunded_by = ?';
        }
        refundShiftParams.push(toMySQLDateTime(shiftStart));
        refundShiftQuery += ' AND refunded_at >= ?';
        if (shiftEnd) {
          refundShiftParams.push(toMySQLDateTime(shiftEnd));
          refundShiftQuery += ' AND refunded_at <= ?';
        }
      }
      const refundShiftResult = await executeQueryOne<{ refund_total: number }>(refundShiftQuery, refundShiftParams);

      const shiftSales = shiftResult?.cash_total || 0;
      const shiftRefunds = refundShiftResult?.refund_total || 0;
      const daySales = wholeDayResult?.cash_total || 0;
      const dayRefunds = dayRefundResult?.refund_total || 0;

      return {
        cash_shift: shiftSales - shiftRefunds,
        cash_shift_sales: shiftSales,
        cash_shift_refunds: shiftRefunds,
        cash_whole_day: daySales - dayRefunds,
        cash_whole_day_sales: daySales,
        cash_whole_day_refunds: dayRefunds
      };
    } catch (error) {
      console.error('Error getting cash summary:', error);
      return {
        cash_shift: 0,
        cash_whole_day: 0
      };
    }
  });

  // Get shifts with filtering
  ipcMain.handle('localdb-get-shifts', async (event, filters: { businessId?: number; startDate?: string; endDate?: string; userId?: number; limit?: number } = {}) => {
    try {
      // Select only needed columns for better performance
      let query = 'SELECT id, uuid_id, business_id, user_id, user_name, shift_start, shift_end, modal_awal, kas_akhir, kas_expected, kas_selisih, kas_selisih_label, cash_sales_total, cash_refund_total, status, created_at, updated_at, synced_at FROM shifts WHERE 1=1';
      const params: (string | number | null | boolean)[] = [];

      if (filters.businessId) {
        query += ' AND business_id = ?';
        params.push(filters.businessId);
      }

      if (filters.userId) {
        query += ' AND user_id = ?';
        params.push(filters.userId);
      }

      if (filters.startDate) {
        query += ' AND shift_start >= ?';
        // Check if already in MySQL format (YYYY-MM-DD HH:MM:SS), otherwise convert
        const dateStr = filters.startDate;
        if (dateStr.includes('T') || dateStr.includes('Z')) {
          params.push(toMySQLDateTime(dateStr));
        } else {
          // Already in MySQL format
          params.push(dateStr);
        }
      }

      if (filters.endDate) {
        query += ' AND shift_start <= ?';
        // Check if already in MySQL format (YYYY-MM-DD HH:MM:SS), otherwise convert
        const dateStr = filters.endDate;
        if (dateStr.includes('T') || dateStr.includes('Z')) {
          params.push(toMySQLDateTime(dateStr));
        } else {
          // Already in MySQL format
          params.push(dateStr);
        }
      }

      query += ' ORDER BY shift_start DESC';

      // LIMIT must be a number, not a parameter in some MySQL configurations
      // Use string interpolation for safety (limit is always a number from our code)
      if (filters.limit && filters.limit > 0) {
        const limitValue = Math.floor(Number(filters.limit));
        if (limitValue > 0 && limitValue <= 10000) { // Sanity check
          query += ` LIMIT ${limitValue}`;
        }
      }

      const shifts = await executeQuery(query, params);
      return { shifts: shifts || [], count: Array.isArray(shifts) ? shifts.length : 0 };
    } catch (error) {
      console.error('Error getting shifts:', error);
      return { shifts: [], count: 0 };
    }
  });

  // Get unsynced shifts
  ipcMain.handle('localdb-get-unsynced-shifts', async (event, businessId?: number) => {
    try {
      let query = 'SELECT * FROM shifts WHERE synced_at IS NULL';
      const params: (string | number | null | boolean)[] = [];

      if (businessId) {
        query += ' AND business_id = ?';
        params.push(businessId);
      }

      query += ' ORDER BY created_at ASC';

      return await executeQuery(query, params);
    } catch (error) {
      console.error('Error getting unsynced shifts:', error);
      return [];
    }
  });

  // Mark shifts as synced
  ipcMain.handle('localdb-mark-shifts-synced', async (event, shiftIds: number[]) => {
    if (shiftIds.length === 0) return { success: true };
    try {
      const placeholders = shiftIds.map(() => '?').join(',');
      // synced_at is BIGINT (timestamp in milliseconds), not DATETIME
      await executeUpdate(`UPDATE shifts SET synced_at = ? WHERE id IN (${placeholders})`, [Date.now(), ...shiftIds]);
      return { success: true };
    } catch (error) {
      console.error('Error marking shifts as synced:', error);
      return { success: false };
    }
  });

  // Upsert shifts (for downloading from server)
  ipcMain.handle('localdb-upsert-shifts', async (event, rows: RowArray) => {
    if (!Array.isArray(rows) || rows.length === 0) return { success: true, count: 0 };

    try {
      const queries = rows.map(row => {
        const id = typeof row.id === 'number' ? row.id : (row.id ? parseInt(String(row.id), 10) : null);
        const uuidId = typeof row.uuid_id === 'string' ? row.uuid_id : String(row.uuid_id ?? '');
        const businessId = typeof row.business_id === 'number' ? row.business_id : (row.business_id ? Number(row.business_id) : 0);
        const userId = typeof row.user_id === 'number' ? row.user_id : (row.user_id ? Number(row.user_id) : 0);
        const userName = typeof row.user_name === 'string' ? row.user_name : String(row.user_name ?? '');
        const shiftStart = row.shift_start ? (typeof row.shift_start === 'number' || typeof row.shift_start === 'string' ? row.shift_start : new Date()) : new Date();
        const shiftEnd = row.shift_end ? (typeof row.shift_end === 'number' || typeof row.shift_end === 'string' ? row.shift_end : null) : null;
        const modalAwal = typeof row.modal_awal === 'number' ? row.modal_awal : (row.modal_awal ? Number(row.modal_awal) : 0);
        const kasAkhir = typeof row.kas_akhir === 'number' ? row.kas_akhir : (row.kas_akhir ? Number(row.kas_akhir) : null);
        const kasExpected = typeof row.kas_expected === 'number' ? row.kas_expected : (row.kas_expected ? Number(row.kas_expected) : null);
        const kasSelisih = typeof row.kas_selisih === 'number' ? row.kas_selisih : (row.kas_selisih ? Number(row.kas_selisih) : null);
        const kasSelisihLabel = typeof row.kas_selisih_label === 'string' ? row.kas_selisih_label : 'balanced';
        const cashSalesTotal = typeof row.cash_sales_total === 'number' ? row.cash_sales_total : (row.cash_sales_total ? Number(row.cash_sales_total) : null);
        const cashRefundTotal = typeof row.cash_refund_total === 'number' ? row.cash_refund_total : (row.cash_refund_total ? Number(row.cash_refund_total) : null);
        const status = typeof row.status === 'string' ? row.status : 'active';
        const createdAt = row.created_at ? (typeof row.created_at === 'number' || typeof row.created_at === 'string' ? row.created_at : new Date()) : new Date();
        // updated_at and synced_at are BIGINT (timestamp in milliseconds), not DATETIME
        const updatedAt = row.updated_at ? (typeof row.updated_at === 'number' ? row.updated_at : (typeof row.updated_at === 'string' ? parseInt(row.updated_at, 10) : Date.now())) : null;
        const syncedAt = row.synced_at ? (typeof row.synced_at === 'number' ? row.synced_at : (typeof row.synced_at === 'string' ? parseInt(row.synced_at, 10) : Date.now())) : null;

        return {
          sql: `
            INSERT INTO shifts (
              id, uuid_id, business_id, user_id, user_name, shift_start, shift_end,
              modal_awal, kas_akhir, kas_expected, kas_selisih, kas_selisih_label,
              cash_sales_total, cash_refund_total, status, created_at, updated_at, synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              id = VALUES(id),
              business_id = VALUES(business_id),
              user_id = VALUES(user_id),
              user_name = VALUES(user_name),
              shift_start = VALUES(shift_start),
              shift_end = VALUES(shift_end),
              modal_awal = VALUES(modal_awal),
              kas_akhir = VALUES(kas_akhir),
              kas_expected = VALUES(kas_expected),
              kas_selisih = VALUES(kas_selisih),
              kas_selisih_label = VALUES(kas_selisih_label),
              cash_sales_total = VALUES(cash_sales_total),
              cash_refund_total = VALUES(cash_refund_total),
              status = VALUES(status),
              created_at = VALUES(created_at),
              updated_at = VALUES(updated_at),
              synced_at = VALUES(synced_at)
          `,
          params: [
            id,
            uuidId,
            businessId,
            userId,
            userName,
            toMySQLDateTime(shiftStart),
            shiftEnd ? toMySQLDateTime(shiftEnd) : null,
            modalAwal,
            kasAkhir,
            kasExpected,
            kasSelisih,
            kasSelisihLabel,
            cashSalesTotal,
            cashRefundTotal,
            status,
            toMySQLDateTime(createdAt),
            updatedAt, // BIGINT timestamp
            syncedAt  // BIGINT timestamp
          ]
        };
      });

      await executeTransaction(queries);
      return { success: true, count: rows.length };
    } catch (error) {
      console.error('Error upserting shifts:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Check for transactions before shift start (today)
  ipcMain.handle('localdb-check-today-transactions', async (event, userId: number, shiftStart: string, businessId: number | null = null) => {
    try {
      if (businessId === null) {
        return { hasTransactions: false, count: 0 };
      }
      // Get start of day in GMT+7
      const shiftDate = new Date(shiftStart);
      const gmt7Offset = 7 * 60 * 60 * 1000;
      const localTime = new Date(shiftDate.getTime() + gmt7Offset);
      const year = localTime.getUTCFullYear();
      const month = localTime.getUTCMonth();
      const day = localTime.getUTCDate();

      const dayStartUTC = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
      const dayStart = new Date(dayStartUTC.getTime() - gmt7Offset);

      // Check for transactions before shift_start but on the same day
      // AND ensure they are not already linked to another shift
      const result = await executeQueryOne<{ count: number; earliest_time: string | null }>(`
        SELECT COUNT(*) as count, MIN(created_at) as earliest_time
        FROM transactions
        WHERE user_id = ? 
        AND business_id = ?
        AND created_at >= ?
        AND created_at < ?
        AND status = 'completed'
        AND (shift_uuid IS NULL OR shift_uuid = '')
      `, [userId, businessId, toMySQLDateTime(dayStart), toMySQLDateTime(shiftStart)]);

      return {
        hasTransactions: (result?.count || 0) > 0,
        count: result?.count || 0,
        earliestTime: result?.earliest_time || null
      };
    } catch (error) {
      console.error('Error checking today transactions:', error);
      return { hasTransactions: false, count: 0, earliestTime: null };
    }
  });

  // Update shift start time to include earlier transactions
  ipcMain.handle('localdb-update-shift-start', async (event, shiftId: number, newStartTime: string) => {
    try {
      // 1. Get shift details first to have the UUID and User ID
      const shift = await executeQueryOne<{ uuid_id: string, user_id: number }>('SELECT uuid_id, user_id FROM shifts WHERE id = ?', [shiftId]);

      if (!shift) {
        return { success: false, error: 'Shift not found' };
      }

      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];

      // 2. Update the shift start time
      queries.push({
        sql: `
          UPDATE shifts 
          SET shift_start = ?, updated_at = ?
          WHERE id = ? AND status = 'active'
        `,
        params: [toMySQLDateTime(newStartTime), Date.now(), shiftId]
      });

      // 3. Link the transactions in the new time range to this shift
      queries.push({
        sql: `
          UPDATE transactions
          SET shift_uuid = ?
          WHERE user_id = ? 
          AND created_at >= ?
          AND (shift_uuid IS NULL OR shift_uuid = '')
        `,
        params: [shift.uuid_id, shift.user_id, newStartTime]
      });

      await executeTransaction(queries);

      // Get count of linked transactions
      const linkCountResult = await executeQueryOne<{ count: number }>(`
        SELECT COUNT(*) as count FROM transactions
        WHERE user_id = ? 
        AND created_at >= ?
        AND shift_uuid = ?
      `, [shift.user_id, newStartTime, shift.uuid_id]);

      console.log(`✅ [SHIFTS] Updated shift ${shiftId} start time to ${newStartTime}`);
      console.log(`🔗 [SHIFTS] Linked ${linkCountResult?.count || 0} transactions to shift ${shift.uuid_id}`);

      return { success: true };
    } catch (error) {
      console.error('Error updating shift start time:', error);
      return { success: false, error: String(error) };
    }
  });

  // Update a single transaction's shift (super admin only - enforced in frontend)
  ipcMain.handle('localdb-update-transaction-shift', async (event, transactionUuid: string, shiftUuid: string | null) => {
    try {
      if (!transactionUuid || typeof transactionUuid !== 'string') {
        return { success: false, error: 'Transaction UUID is required' };
      }
      await executeUpdate(
        'UPDATE transactions SET shift_uuid = ? WHERE uuid_id = ?',
        [shiftUuid ?? null, transactionUuid]
      );
      return { success: true };
    } catch (error) {
      console.error('Error updating transaction shift:', error);
      return { success: false, error: String(error) };
    }
  });

  /**
   * Get "Paket" sales breakdown for shift/date range.
   *
   * - Finds package products by `products.category1_id = 14`
   * - Returns package totals (qty + allocated gross subtotal) and nested sub-items (qty only)
   * - Uses the same allocation formula as Category II:
   *     allocated = ti.total_price / tx_items_total * (t.total_amount - t.refund_total)
   * - Refund (full & partial) excluded from amount. Fully refunded tx excluded.
   *
   * When shiftUuids (non-empty): filter by t.shift_uuid IN (...).
   * When shiftUuid: filter by t.shift_uuid = ?.
   * Else: userId + time range.
   */
  ipcMain.handle(
    'localdb-get-package-sales-breakdown',
    async (
      event,
      userId: number | null,
      shiftStart: string,
      shiftEnd: string | null,
      businessId: number | null = null,
      shiftUuid?: string | null,
      shiftUuids?: string[]
    ) => {
      try {
        if (businessId === null) {
          return [];
        }

        const shiftStartMySQL = toMySQLDateTime(shiftStart);
        const shiftEndMySQL = shiftEnd ? toMySQLDateTime(shiftEnd) : null;

        type PackageParentRow = {
          item_uuid: string;
          package_product_id: number;
          package_product_name: string;
          package_qty: number;
          package_total_price: number;
          tx_total_amount: number;
          tx_items_total: number;
        };

        let query = `
          SELECT
            ti.uuid_id as item_uuid,
            p.id as package_product_id,
            p.nama as package_product_name,
            ti.quantity as package_qty,
            ti.total_price as package_total_price,
            COALESCE(GREATEST(0, (t.total_amount - COALESCE(t.refund_total, 0))), 0) as tx_total_amount,
            (SELECT COALESCE(SUM(ti2.total_price), 0) FROM transaction_items ti2 WHERE ti2.transaction_id = ti.transaction_id AND (ti2.production_status IS NULL OR ti2.production_status != 'cancelled')) as tx_items_total
          FROM transaction_items ti
          INNER JOIN transactions t ON ti.transaction_id = t.id
          INNER JOIN products p ON ti.product_id = p.id
          WHERE t.business_id = ?
            AND t.status = 'completed'
            AND t.refund_status != 'full'
            AND p.category1_id = 14
            AND (ti.production_status IS NULL OR ti.production_status != 'cancelled')
        `;
        const params: (string | number | null | boolean)[] = [businessId];

        if (shiftUuids && shiftUuids.length > 0) {
          query += ' AND t.shift_uuid IN (' + shiftUuids.map(() => '?').join(',') + ')';
          params.push(...shiftUuids);
        } else if (shiftUuid) {
          query += ' AND t.shift_uuid = ?';
          params.push(shiftUuid);
        } else {
          if (userId !== null) {
            query = query.replace('WHERE t.business_id = ?', 'WHERE t.user_id = ? AND t.business_id = ?');
            params.unshift(userId);
          }
          query += ' AND t.created_at >= ?';
          params.push(shiftStartMySQL);
          if (shiftEndMySQL) {
            query += ' AND t.created_at <= ?';
            params.push(shiftEndMySQL);
          }
        }

        const parentRows = await executeQuery<PackageParentRow>(query, params);
        if (!parentRows || parentRows.length === 0) {
          return [];
        }

        type PackageLineAgg = { product_id: number; product_name: string; total_quantity: number };
        type PackageAgg = {
          package_product_id: number;
          package_product_name: string;
          total_quantity: number;
          total_amount: number;
          base_unit_price: number;
          lines: PackageLineAgg[];
          _linesMap: Map<number, PackageLineAgg>;
        };

        const packages = new Map<number, PackageAgg>();
        const itemToParent = new Map<string, { package_product_id: number; package_qty: number }>();
        const itemUuids: string[] = [];

        for (const row of parentRows) {
          const itemUuid = String(row.item_uuid || '').trim();
          if (!itemUuid) continue;

          const pkgId = Number(row.package_product_id) || 0;
          const pkgName = String(row.package_product_name || '').trim() || 'Unknown Paket';
          const pkgQty = Number(row.package_qty) || 0;
          const pkgTotalPrice = Number(row.package_total_price) || 0;
          const txTotalAmount = Number(row.tx_total_amount) || 0;
          const txItemsTotal = Number(row.tx_items_total) || 0;

          // Allocate gross total_amount proportionally to this line item (aligns with Category II)
          const allocated = txItemsTotal > 0 ? (pkgTotalPrice / txItemsTotal) * txTotalAmount : 0;

          itemToParent.set(itemUuid, { package_product_id: pkgId, package_qty: pkgQty });
          itemUuids.push(itemUuid);

          const existing = packages.get(pkgId);
          if (existing) {
            existing.total_quantity += pkgQty;
            existing.total_amount += allocated;
          } else {
            packages.set(pkgId, {
              package_product_id: pkgId,
              package_product_name: pkgName,
              total_quantity: pkgQty,
              total_amount: allocated,
              base_unit_price: 0,
              lines: [],
              _linesMap: new Map<number, PackageLineAgg>(),
            });
          }
        }

        const chunkArray = <T,>(arr: T[], size: number): T[][] => {
          const out: T[][] = [];
          for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
          return out;
        };

        // Load nested package lines (qty per package). Multiply by purchased package qty for true consumption.
        type RawPackageLineRow = {
          uuid_transaction_item_id: string;
          product_id: number;
          product_name: string;
          quantity: number;
        };

        const chunks = chunkArray(itemUuids, 500);
        for (const chunk of chunks) {
          if (chunk.length === 0) continue;
          const placeholders = chunk.map(() => '?').join(',');
          const lineRows = await executeQuery<RawPackageLineRow>(
            `
              SELECT
                tipl.uuid_transaction_item_id,
                tipl.product_id,
                COALESCE(p.nama, 'Unknown') as product_name,
                tipl.quantity
              FROM transaction_item_package_lines tipl
              LEFT JOIN products p ON tipl.product_id = p.id
              WHERE tipl.uuid_transaction_item_id IN (${placeholders})
            `,
            chunk
          );

          for (const lr of lineRows) {
            const itemUuid = String(lr.uuid_transaction_item_id || '').trim();
            if (!itemUuid) continue;
            const parent = itemToParent.get(itemUuid);
            if (!parent) continue;

            const pkg = packages.get(parent.package_product_id);
            if (!pkg) continue;

            const subProductId = Number(lr.product_id) || 0;
            const subName = String(lr.product_name || '').trim() || 'Unknown';
            const perPkgQty = Number(lr.quantity) || 0;
            const totalQty = perPkgQty * (Number(parent.package_qty) || 0);
            if (subProductId <= 0 || totalQty <= 0) continue;

            const existingLine = pkg._linesMap.get(subProductId);
            if (existingLine) {
              existingLine.total_quantity += totalQty;
            } else {
              pkg._linesMap.set(subProductId, {
                product_id: subProductId,
                product_name: subName,
                total_quantity: totalQty,
              });
            }
          }
        }

        // Finalize output: compute unit prices and convert internal maps to arrays.
        const result = Array.from(packages.values()).map((pkg) => {
          const qty = Number(pkg.total_quantity) || 0;
          const amt = Number(pkg.total_amount) || 0;
          pkg.base_unit_price = qty > 0 ? amt / qty : 0;
          pkg.lines = Array.from(pkg._linesMap.values()).sort((a, b) => a.product_name.localeCompare(b.product_name));
          // @ts-expect-error internal-only map for building result
          delete pkg._linesMap;
          return pkg;
        });

        // Sort packages by amount desc, then name
        result.sort((a, b) => {
          const da = Number(a.total_amount) || 0;
          const db = Number(b.total_amount) || 0;
          if (db !== da) return db - da;
          return String(a.package_product_name).localeCompare(String(b.package_product_name));
        });

        return result;
      } catch (error) {
        console.error('Error getting package sales breakdown:', error);
        return [];
      }
    }
  );

  // Get product sales breakdown for shift. Allocate net amount (gross - refund) to items proportionally. Refund (full & partial) excluded.
  // When shiftUuids (non-empty): filter by t.shift_uuid IN (...). When shiftUuid: filter by t.shift_uuid = ?. Else: userId + time.
  ipcMain.handle('localdb-get-product-sales', async (event, userId: number | null, shiftStart: string, shiftEnd: string | null, businessId: number | null = null, shiftUuid?: string | null, shiftUuids?: string[]) => {
    try {
      if (businessId === null) {
        return [];
      }
      const shiftStartMySQL = toMySQLDateTime(shiftStart);
      const shiftEndMySQL = shiftEnd ? toMySQLDateTime(shiftEnd) : null;

      let query = `
        SELECT 
          ti.uuid_id as id,
          p.id as product_id,
          p.nama as product_name,
          p.menu_code as product_code,
          ti.quantity,
          ti.unit_price,
          ti.total_price,
          ti.bundle_selections_json,
          t.transaction_type,
          pm.code as payment_method_code,
          t.payment_method as payment_method,
          p.harga_jual,
          p.harga_gofood,
          p.harga_grabfood,
          p.harga_shopeefood,
          p.harga_qpon,
          p.harga_tiktok,
          COALESCE(t.refund_total, 0) as refund_total,
          t.final_amount,
          t.total_amount,
          (SELECT COALESCE(SUM(ti2.total_price), 0) FROM transaction_items ti2 WHERE ti2.transaction_id = ti.transaction_id AND (ti2.production_status IS NULL OR ti2.production_status != 'cancelled')) as tx_items_total
        FROM transaction_items ti
        INNER JOIN transactions t ON ti.transaction_id = t.id
        LEFT JOIN payment_methods pm ON t.payment_method_id = pm.id
        INNER JOIN products p ON ti.product_id = p.id
        WHERE t.business_id = ?
        AND t.status = 'completed'
        AND t.refund_status != 'full'
        AND (ti.production_status IS NULL OR ti.production_status != 'cancelled')
      `;
      const params: (string | number | null | boolean)[] = [businessId];

      if (shiftUuids && shiftUuids.length > 0) {
        query += ' AND t.shift_uuid IN (' + shiftUuids.map(() => '?').join(',') + ')';
        params.push(...shiftUuids);
      } else if (shiftUuid) {
        query += ' AND t.shift_uuid = ?';
        params.push(shiftUuid);
      } else {
        if (userId !== null) {
          query = query.replace('WHERE t.business_id = ?', 'WHERE t.user_id = ? AND t.business_id = ?');
          params.unshift(userId);
        }
        query += ' AND t.created_at >= ?';
        params.push(shiftStartMySQL);
        if (shiftEnd) {
          query += ' AND t.created_at <= ?';
          params.push(toMySQLDateTime(shiftEnd));
        }
      }

      const rows = await executeQuery<TransactionItemRow>(query, params);

      type ProductAccumulator = {
        product_id: number;
        product_name: string;
        product_code: string;
        platform: string;
        transaction_type: string;
        total_quantity: number;
        total_subtotal: number;
        customization_subtotal: number;
        base_subtotal: number;
        unit_price: number; // Store the unit price to split by price differences
      };

      type CustomizationAccumulator = {
        option_id: number;
        option_name: string;
        customization_id: number;
        customization_name: string;
        total_quantity: number;
        total_revenue: number;
      };

      const aggregate = new Map<string, ProductAccumulator>();
      const bundleItemsAggregate = new Map<string, ProductAccumulator>();
      const customizationAggregate = new Map<number, CustomizationAccumulator>();
      const OFFLINE_METHODS = new Set(['cash', 'debit', 'qr', 'ewallet', 'cl', 'voucher', 'offline']);

      const sumCustomizationForRow = async (row: TransactionItemRow, unitQuantity: number): Promise<number> => {
        let customizationTotal = 0;

        // Read from normalized tables instead of JSON
        // row.id should be the uuid_id (UUID string) from the SELECT clause
        const itemUuid = row.id ? String(row.id) : '';
        if (!itemUuid) {
          console.warn('⚠️ TransactionItemRow missing id (uuid_id), skipping customizations');
          return 0;
        }
        const customizations = await readCustomizationsFromNormalizedTables(itemUuid, null);
        if (!customizations || customizations.length === 0) return 0;
        for (const customization of customizations) {
          if (!Array.isArray(customization?.selected_options)) continue;
          for (const option of customization.selected_options) {
            const adjustment = Number(option?.price_adjustment || 0);
            customizationTotal += adjustment;
            const optionId = Number(option?.option_id);
            if (Number.isNaN(optionId)) {
              continue;
            }

            const existingOption = customizationAggregate.get(optionId);
            if (existingOption) {
              existingOption.total_quantity += unitQuantity;
              existingOption.total_revenue += adjustment * unitQuantity;
            } else {
              customizationAggregate.set(optionId, {
                option_id: optionId,
                option_name: option?.option_name || 'Unknown Option',
                customization_id: Number(customization?.customization_id) || 0,
                customization_name: customization?.customization_name || 'Unknown Customization',
                total_quantity: unitQuantity,
                total_revenue: adjustment * unitQuantity,
              });
            }
          }
        }

        const bundleSelections = parseJsonArray<RawBundleSelection>(row.bundle_selections_json, 'bundle_selections_json');
        if (bundleSelections.length > 0) {
          const rawPlatform = (row.payment_method_code || row.payment_method || '').toString().toLowerCase();
          const platformCode = rawPlatform && !OFFLINE_METHODS.has(rawPlatform) ? rawPlatform : 'offline';
          const transactionType = row.transaction_type || 'drinks';

          for (const selection of bundleSelections) {
            if (!Array.isArray(selection?.selectedProducts)) continue;

            for (const selectedProduct of selection.selectedProducts) {
              const selectionQty =
                typeof selectedProduct?.quantity === 'number' && !Number.isNaN(selectedProduct.quantity)
                  ? selectedProduct.quantity
                  : 1;
              const totalQty = selectionQty * unitQuantity;

              if (selectedProduct?.product?.id) {
                // Use the same platform detection for bundle items (from parent row)
                const bundlePlatform = determinePlatform(row);
                const bundleItemKey = `${selectedProduct.product.id}-${bundlePlatform}-${transactionType}`;
                const existingBundleItem = bundleItemsAggregate.get(bundleItemKey);

                if (existingBundleItem) {
                  existingBundleItem.total_quantity += totalQty;
                } else {
                  bundleItemsAggregate.set(bundleItemKey, {
                    product_id: Number(selectedProduct.product.id),
                    product_name: selectedProduct.product.nama || 'Unknown Product',
                    product_code: '',
                    platform: bundlePlatform,
                    transaction_type: transactionType,
                    total_quantity: totalQty,
                    total_subtotal: 0,
                    customization_subtotal: 0,
                    base_subtotal: 0,
                    unit_price: 0, // Bundle items don't have individual prices
                  });
                }
              }

              if (!Array.isArray(selectedProduct?.customizations)) continue;

              for (const customization of selectedProduct.customizations) {
                if (!Array.isArray(customization?.selected_options)) continue;

                for (const option of customization.selected_options) {
                  const adjustment = Number(option?.price_adjustment || 0);
                  const qty = selectionQty * unitQuantity;
                  customizationTotal += adjustment * selectionQty;

                  const optionId = Number(option?.option_id);
                  if (Number.isNaN(optionId)) {
                    continue;
                  }

                  const existingOption = customizationAggregate.get(optionId);
                  if (existingOption) {
                    existingOption.total_quantity += qty;
                    existingOption.total_revenue += adjustment * qty;
                  } else {
                    customizationAggregate.set(optionId, {
                      option_id: optionId,
                      option_name: option?.option_name || 'Unknown Option',
                      customization_id: Number(customization?.customization_id) || 0,
                      customization_name: customization?.customization_name || 'Unknown Customization',
                      total_quantity: qty,
                      total_revenue: adjustment * qty,
                    });
                  }
                }
              }
            }
          }
        }

        return customizationTotal * unitQuantity || 0;
      };

      // Helper function to determine platform from unit price
      const determinePlatform = (row: TransactionItemRow): string => {
        const unitPrice = Number(row.unit_price || 0);

        // Compare unit price with platform-specific prices
        // Allow small tolerance for floating point comparison (0.01)
        const tolerance = 0.01;

        if (row.harga_gofood && Math.abs(unitPrice - Number(row.harga_gofood)) < tolerance) {
          return 'gofood';
        }
        if (row.harga_grabfood && Math.abs(unitPrice - Number(row.harga_grabfood)) < tolerance) {
          return 'grabfood';
        }
        if (row.harga_shopeefood && Math.abs(unitPrice - Number(row.harga_shopeefood)) < tolerance) {
          return 'shopeefood';
        }
        if (row.harga_qpon && Math.abs(unitPrice - Number(row.harga_qpon)) < tolerance) {
          return 'qpon';
        }
        if (row.harga_tiktok && Math.abs(unitPrice - Number(row.harga_tiktok)) < tolerance) {
          return 'tiktok';
        }

        // Default to offline
        return 'offline';
      };

      for (const row of rows) {
        const quantity = Number(row.quantity || 0);
        const totalPrice = Number(row.total_price || 0);
        const unitPrice = Number(row.unit_price || 0);
        const customizationSubtotal = await sumCustomizationForRow(row, quantity);
        let baseSubtotal = totalPrice - customizationSubtotal;

        if (baseSubtotal < 0) {
          baseSubtotal = 0;
        }

        // Allocate net transaction amount (gross - refund) to items proportionally
        const totalAmountTx = Number(row.total_amount ?? 0);
        const refundTotal = Number(row.refund_total ?? 0);
        const netAmountTx = Math.max(0, totalAmountTx - refundTotal);
        const txItemsTotal = Number(row.tx_items_total ?? 0);
        const allocatedRatio = txItemsTotal > 0 ? netAmountTx / txItemsTotal : 0;
        const netBaseSubtotal = baseSubtotal * allocatedRatio;
        const netTotalPrice = totalPrice * allocatedRatio;
        const netCustomizationSubtotal = customizationSubtotal * allocatedRatio;

        // Determine platform based on product price, not payment method
        const platformCode = determinePlatform(row);
        const transactionType = row.transaction_type || 'drinks';
        // Include unit_price in the key to split products with different prices into separate rows
        const key = `${row.product_id}-${platformCode}-${transactionType}-${unitPrice}`;

        const existing = aggregate.get(key);

        if (existing) {
          existing.total_quantity += quantity;
          existing.total_subtotal += netTotalPrice;
          existing.customization_subtotal += netCustomizationSubtotal;
          existing.base_subtotal += netBaseSubtotal;
        } else {
          aggregate.set(key, {
            product_id: Number(row.product_id),
            product_name: row.product_name,
            product_code: row.product_code,
            platform: platformCode,
            transaction_type: transactionType,
            total_quantity: quantity,
            total_subtotal: netTotalPrice,
            customization_subtotal: netCustomizationSubtotal,
            base_subtotal: netBaseSubtotal,
            unit_price: unitPrice,
          });
        }
      }

      const regularProducts = Array.from(aggregate.values()).map(product => {
        const quantity = product.total_quantity || 0;
        const baseSubtotal = product.base_subtotal || 0;
        // Use the stored unit_price instead of calculating average
        // This ensures products with different prices are split into separate rows
        const baseUnitPrice = product.unit_price || (quantity > 0 ? baseSubtotal / quantity : 0);
        return {
          ...product,
          base_unit_price: baseUnitPrice,
          is_bundle_item: false,
        };
      });

      const bundleItems = Array.from(bundleItemsAggregate.values()).map(product => {
        const bundleItem = {
          ...product,
          base_unit_price: 0,
          is_bundle_item: true,
        };
        console.log(`[SHIFT REPORT] Bundle item: ${bundleItem.product_name}, is_bundle_item: ${bundleItem.is_bundle_item}`);
        return bundleItem;
      });

      // Create a map to track bundle item keys to avoid duplicates
      const bundleItemKeys = new Set(
        bundleItems.map(item => `${item.product_id}-${item.platform}-${item.transaction_type}`)
      );

      // Filter out any regular products that are actually bundle items
      const filteredRegularProducts = regularProducts.filter(product => {
        const key = `${product.product_id}-${product.platform}-${product.transaction_type}`;
        return !bundleItemKeys.has(key);
      });

      const allProducts = [...filteredRegularProducts, ...bundleItems].sort((a, b) => {
        if (a.product_name === b.product_name) {
          if (a.is_bundle_item !== b.is_bundle_item) {
            return a.is_bundle_item ? 1 : -1;
          }
          return a.platform.localeCompare(b.platform);
        }
        return a.product_name.localeCompare(b.product_name);
      });

      return {
        products: allProducts,
        customizations: Array.from(customizationAggregate.values()).sort((a, b) => b.total_quantity - a.total_quantity),
      };
    } catch (error) {
      console.error('Error getting product sales:', error);
      return { products: [], customizations: [] };
    }
  });

  // Payment Methods
  ipcMain.handle('localdb-upsert-payment-methods', async (event, rows: RowArray) => {
    try {
      const queries = rows.map(r => {
        const id = typeof r.id === 'number' ? r.id : (r.id ? parseInt(String(r.id), 10) : null);
        const name = typeof r.name === 'string' ? r.name : (r.name ? String(r.name) : null);
        const code = typeof r.code === 'string' ? r.code : (r.code ? String(r.code) : null);
        const description = typeof r.description === 'string' ? r.description : (r.description ? String(r.description) : null);
        const isActive = typeof r.is_active === 'number' ? r.is_active : (r.is_active ? 1 : 0);
        const requiresAdditionalInfo = typeof r.requires_additional_info === 'number' ? r.requires_additional_info : (r.requires_additional_info ? 1 : 0);
        const createdAt = r.created_at ? (typeof r.created_at === 'number' || typeof r.created_at === 'string' ? r.created_at : new Date()) : new Date();

        return {
          sql: `INSERT INTO payment_methods (
            id, name, code, description, is_active, requires_additional_info, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name=VALUES(name), code=VALUES(code), description=VALUES(description),
            is_active=VALUES(is_active), requires_additional_info=VALUES(requires_additional_info),
            created_at=VALUES(created_at), updated_at=VALUES(updated_at)`,
          params: [id, name, code, description, isActive, requiresAdditionalInfo, toMySQLTimestamp(createdAt), toMySQLTimestamp(Date.now())]
        };
      });
      await executeTransaction(queries);
      await upsertMasterDataToSystemPos(queries);
      return { success: true };
    } catch (error) {
      console.error('Error upserting payment methods:', error);
      return { success: false };
    }
  });

  ipcMain.handle('localdb-get-payment-methods', async () => {
    try {
      return await executeQuery('SELECT * FROM payment_methods WHERE is_active = 1 ORDER BY name ASC');
    } catch (error) {
      console.error('Error getting payment methods:', error);
      return [];
    }
  });

  // Banks
  ipcMain.handle('localdb-upsert-banks', async (event, rows: RowArray) => {
    try {
      const queries = rows.map(r => {
        const getId = () => {
          const val = r.id;
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getString = (key: string) => (typeof r[key] === 'string' ? r[key] as string : null);
        const getNumber = (key: string) => {
          const val = r[key];
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getBoolean = (key: string) => {
          const val = r[key];
          if (typeof val === 'boolean') return val;
          if (typeof val === 'number') return val === 1;
          if (typeof val === 'string') return val === 'true' || val === '1';
          return null;
        };
        const getDate = (key: string) => {
          const val = r[key];
          if (val instanceof Date) return val;
          if (typeof val === 'string' || typeof val === 'number') return val;
          return null;
        };
        const createdDate = getDate('created_at');
        const createdAt = createdDate ? toMySQLTimestamp(createdDate as string | number | Date) : toMySQLTimestamp(new Date());
        return {
          sql: `
            INSERT INTO banks (id, bank_code, bank_name, is_popular, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              bank_code=VALUES(bank_code),
              bank_name=VALUES(bank_name),
              is_popular=VALUES(is_popular),
              is_active=VALUES(is_active),
              created_at=VALUES(created_at)
          `,
          params: [
            getId(),
            getString('bank_code'),
            getString('bank_name'),
            getNumber('is_popular') ?? 0,
            getBoolean('is_active') !== null ? (getBoolean('is_active') ? 1 : 0) : 1,
            createdAt
          ] as (string | number | null | boolean)[]
        };
      });
      await executeTransaction(queries);
      return { success: true };
    } catch (error) {
      console.error('Error upserting banks:', error);
      return { success: false, error: String(error) };
    }
  });

  // Receipt Settings
  ipcMain.handle('localdb-upsert-receipt-settings', async (event, rows: RowArray) => {
    writeDebugLog(JSON.stringify({ location: 'main.ts:localdb-upsert-receipt-settings', message: 'Receipt settings upsert start', data: { rowCount: rows?.length ?? 0 }, timestamp: Date.now() }));
    try {
      const queries = rows.map(r => {
        const getId = () => {
          const val = r.id;
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getNumber = (key: string) => {
          const val = r[key];
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getString = (key: string) => (typeof r[key] === 'string' ? r[key] as string : null);
        const getBoolean = (key: string) => {
          const val = r[key];
          if (typeof val === 'boolean') return val;
          if (typeof val === 'number') return val === 1;
          if (typeof val === 'string') return val === 'true' || val === '1';
          return null;
        };
        const getDate = (key: string) => {
          const val = r[key];
          if (val instanceof Date) return val;
          if (typeof val === 'string' || typeof val === 'number') return val;
          return null;
        };
        const id = getId();
        const businessId = getNumber('business_id');
        const storeName = getString('store_name');
        const address = getString('address');
        const phoneNumber = getString('phone_number');
        const contactPhone = getString('contact_phone');
        const logoBase64 = getString('logo_base64');
        const footerText = getString('footer_text');
        const partnershipContact = getString('partnership_contact');
        const isActive = getBoolean('is_active') !== null ? (getBoolean('is_active') ? 1 : 0) : 1;
        const createdDate = getDate('created_at');
        const createdAt = createdDate ? toMySQLTimestamp(createdDate as string | number | Date) : toMySQLTimestamp(new Date());
        const updatedAt = toMySQLTimestamp(Date.now());

        return {
          sql: `INSERT INTO receipt_settings (
            id, business_id, store_name, address, phone_number, contact_phone,
            logo_base64, footer_text, partnership_contact, is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            store_name=VALUES(store_name),
            address=VALUES(address),
            phone_number=VALUES(phone_number),
            contact_phone=VALUES(contact_phone),
            logo_base64=VALUES(logo_base64),
            footer_text=VALUES(footer_text),
            partnership_contact=VALUES(partnership_contact),
            is_active=VALUES(is_active),
            updated_at=VALUES(updated_at)`,
          params: [id, businessId, storeName, address, phoneNumber, contactPhone, logoBase64, footerText, partnershipContact, isActive, createdAt, updatedAt]
        };
      });
      await executeTransaction(queries);
      writeDebugLog(JSON.stringify({ location: 'main.ts:localdb-upsert-receipt-settings', message: 'Receipt settings upsert success', data: { rowCount: rows.length }, timestamp: Date.now() }));
      return { success: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('Error upserting receipt settings:', error);
      writeDebugLog(JSON.stringify({ location: 'main.ts:localdb-upsert-receipt-settings', message: 'Receipt settings upsert error', data: { error: errMsg, rowCount: rows?.length ?? 0 }, timestamp: Date.now() }));
      return { success: false, error: errMsg };
    }
  });

  // Receipt Templates (download master data: upsert to primary MySQL)
  ipcMain.handle('localdb-upsert-receipt-templates', async (event, rows: RowArray) => {
    writeDebugLog(JSON.stringify({ location: 'main.ts:localdb-upsert-receipt-templates', message: 'Receipt templates upsert start', data: { rowCount: rows?.length ?? 0 }, timestamp: Date.now() }));
    try {
      const queries = rows.map(r => {
        const getId = () => {
          const val = r.id;
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getNumber = (key: string) => {
          const val = r[key];
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getString = (key: string) => (typeof r[key] === 'string' ? r[key] as string : null);
        const getBoolean = (key: string) => {
          const val = r[key];
          if (typeof val === 'boolean') return val;
          if (typeof val === 'number') return val === 1;
          if (typeof val === 'string') return val === 'true' || val === '1';
          return null;
        };
        const getDate = (key: string) => {
          const val = r[key];
          if (val instanceof Date) return val;
          if (typeof val === 'string' || typeof val === 'number') return val;
          return null;
        };
        const id = getId();
        const templateType = getString('template_type');
        const templateName = getString('template_name');
        const businessId = getNumber('business_id');
        const templateCode = getString('template_code');
        const isActive = getBoolean('is_active') !== null ? (getBoolean('is_active') ? 1 : 0) : 1;
        const isDefault = getBoolean('is_default') !== null ? (getBoolean('is_default') ? 1 : 0) : 0;
        const showNotes = getNumber('show_notes') ?? getBoolean('show_notes') ? 1 : 0;
        const version = getNumber('version') ?? 1;
        const createdDate = getDate('created_at');
        const createdAt = createdDate ? toMySQLTimestamp(createdDate as string | number | Date) : toMySQLTimestamp(new Date());
        const updatedAt = toMySQLTimestamp(Date.now());

        return {
          sql: `INSERT INTO receipt_templates (
            id, template_type, template_name, business_id, template_code,
            is_active, is_default, show_notes, version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            template_type=VALUES(template_type),
            template_name=VALUES(template_name),
            template_code=VALUES(template_code),
            is_active=VALUES(is_active),
            is_default=VALUES(is_default),
            show_notes=VALUES(show_notes),
            version=VALUES(version),
            updated_at=VALUES(updated_at)`,
          params: [id, templateType, templateName, businessId, templateCode, isActive, isDefault, showNotes, version, createdAt, updatedAt]
        };
      });
      await executeTransaction(queries);
      writeDebugLog(JSON.stringify({ location: 'main.ts:localdb-upsert-receipt-templates', message: 'Receipt templates upsert success', data: { rowCount: rows.length }, timestamp: Date.now() }));
      return { success: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('Error upserting receipt templates:', error);
      writeDebugLog(JSON.stringify({ location: 'main.ts:localdb-upsert-receipt-templates', message: 'Receipt templates upsert error', data: { error: errMsg, rowCount: rows?.length ?? 0 }, timestamp: Date.now() }));
      return { success: false, error: errMsg };
    }
  });

  // Organizations
  ipcMain.handle('localdb-upsert-organizations', async (event, rows: RowArray, skipOwnerValidation: boolean = false) => {
    try {
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];
      let skippedCount = 0;

      for (const r of rows) {
        const getId = () => {
          const val = r.id;
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getNumber = (key: string) => {
          const val = r[key];
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const orgId = getId();
        const ownerUserId = getNumber('owner_user_id');// Skip if owner_user_id is null or invalid
        if (!ownerUserId) {
          skippedCount++;
          continue;
        }

        // Verify user exists before inserting organization - SKIP on first pass to break circular dependency
        if (!skipOwnerValidation) {
          try {
            const userExists = await executeQueryOne<{ id: number }>('SELECT id FROM users WHERE id = ? LIMIT 1', [ownerUserId]); if (!userExists) {
              console.warn(`⚠️ [ORGANIZATIONS] Skipping organization ${orgId}: owner_user_id ${ownerUserId} does not exist`); skippedCount++;
              continue;
            }
          } catch (checkError) {
            console.warn(`⚠️ [ORGANIZATIONS] Error checking user ${ownerUserId} for organization ${orgId}:`, checkError);
            skippedCount++;
            continue;
          }
        } else {
          console.log(`ℹ️ [ORGANIZATIONS] Skipping owner validation for organization ${orgId} (first pass - breaking circular dependency)`);
        }

        const getString = (key: string) => (typeof r[key] === 'string' ? r[key] as string : null);
        const getDate = (key: string) => {
          const val = r[key];
          if (val instanceof Date) return val;
          if (typeof val === 'string' || typeof val === 'number') return val;
          return null;
        };
        const name = getString('name') ?? '';
        const slug = getString('slug') ?? '';
        const subscriptionStatus = getString('subscription_status') ?? 'trial';
        const subscriptionPlan = getString('subscription_plan') ?? 'basic';
        const trialEndsDate = getDate('trial_ends_at');
        const trialEndsAt = trialEndsDate ? toMySQLTimestamp(trialEndsDate as string | number | Date) : null;
        const createdDate = getDate('created_at');
        const updatedDate = getDate('updated_at');
        const createdAt = createdDate ? toMySQLTimestamp(createdDate as string | number | Date) : toMySQLTimestamp(new Date());
        const updatedAt = updatedDate ? toMySQLTimestamp(updatedDate as string | number | Date) : toMySQLTimestamp(Date.now());

        queries.push({
          sql: `INSERT INTO organizations (
            id, name, slug, owner_user_id, subscription_status, subscription_plan,
            trial_ends_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name=VALUES(name), slug=VALUES(slug), owner_user_id=VALUES(owner_user_id),
            subscription_status=VALUES(subscription_status), subscription_plan=VALUES(subscription_plan),
            trial_ends_at=VALUES(trial_ends_at), created_at=VALUES(created_at), updated_at=VALUES(updated_at)`,
          params: [
            orgId, name, slug, ownerUserId, subscriptionStatus,
            subscriptionPlan, trialEndsAt, createdAt, updatedAt
          ]
        });
      }

      if (queries.length > 0) {
        if (skipOwnerValidation) {
          // On first pass (e.g. structure-only DB): insert with FK checks off so organizations can be inserted before users exist
          await executeTransaction(queries, { disableForeignKeyChecks: true });
          await upsertMasterDataToSystemPos(queries);
          console.log(`ℹ️ [ORGANIZATIONS] First pass: ${queries.length} organizations inserted (FK checks off for empty-DB restore)`);
        } else {
          // On retry pass: Use transaction for better performance
          await executeTransaction(queries);
          await upsertMasterDataToSystemPos(queries);
          if (skippedCount > 0) {
            console.log(`⚠️ [ORGANIZATIONS] Skipped ${skippedCount} organizations due to missing owner users`);
          }
        }
      } else {
        console.warn(`⚠️ [ORGANIZATIONS] No valid organizations to insert (all ${rows.length} skipped)`);
      }
      return { success: true };
    } catch (error) {
      console.error('Error upserting organizations:', error);
      return { success: false };
    }
  });

  ipcMain.handle('localdb-get-organizations', async () => {
    try {
      return await executeQuery('SELECT * FROM organizations ORDER BY name ASC');
    } catch (error) {
      console.error('Error getting organizations:', error);
      return [];
    }
  });

  // Skip management_groups IPC handlers - not needed in POS app (CRM-only)

  ipcMain.handle('localdb-check-exists', async () => {
    // MySQL database is always available via connection pool
    return { exists: true, path: 'MySQL connection pool' };
  });

  // Category1
  ipcMain.handle('localdb-upsert-category1', async (event, rows: RowArray) => {
    try {
      const queries = rows.map(r => {
        const id = typeof r.id === 'number' ? r.id : (typeof r.id === 'string' ? parseInt(String(r.id), 10) : 0);
        const name = typeof r.name === 'string' ? r.name : String(r.name ?? '');
        const description = typeof r.description === 'string' ? r.description : (r.description ? String(r.description) : null);
        const displayOrder = typeof r.display_order === 'number' ? r.display_order : 0;
        const isActive = typeof r.is_active === 'number' ? r.is_active : (r.is_active ? 1 : 0);
        const createdAt = r.created_at ? (typeof r.created_at === 'number' || typeof r.created_at === 'string' ? r.created_at : new Date()) : new Date();

        return {
          sql: `INSERT INTO category1 (
            id, name, description, display_order, is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name=VALUES(name), description=VALUES(description), display_order=VALUES(display_order),
            is_active=VALUES(is_active), created_at=VALUES(created_at), updated_at=VALUES(updated_at)`,
          params: [
            id, name, description, displayOrder, isActive,
            toMySQLTimestamp(createdAt),
            toMySQLTimestamp(Date.now())
          ]
        };
      });
      await executeTransaction(queries);
      await upsertMasterDataToSystemPos(queries);
      return { success: true };
    } catch (error) {
      console.error('Error upserting category1:', error);
      return { success: false };
    }
  });

  ipcMain.handle('localdb-get-category1', async () => {
    try {
      return await executeQuery('SELECT * FROM category1 WHERE is_active = 1 ORDER BY display_order ASC, name ASC');
    } catch (error) {
      console.error('Error getting category1:', error);
      return [];
    }
  });

  // Category2
  ipcMain.handle('localdb-upsert-category2', async (event, rows: RowArray, junctionTableData?: Array<{ category2_id: number; business_id: number }>) => {
    try {
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];

      // Upsert category2 records
      const category2Queries = rows.map(r => ({
        sql: `INSERT INTO category2 (
          id, name, description, display_order, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name=VALUES(name), description=VALUES(description),
          display_order=VALUES(display_order), is_active=VALUES(is_active),
          created_at=VALUES(created_at), updated_at=VALUES(updated_at)`,
        params: [
          typeof r.id === 'number' ? r.id : (typeof r.id === 'string' ? parseInt(String(r.id), 10) : 0),
          typeof r.name === 'string' ? r.name : String(r.name ?? ''),
          typeof r.description === 'string' ? r.description : String(r.description ?? ''),
          typeof r.display_order === 'number' ? r.display_order : 0,
          typeof r.is_active === 'number' ? r.is_active : (r.is_active ? 1 : 0),
          toMySQLTimestamp(r.created_at ? (typeof r.created_at === 'number' || typeof r.created_at === 'string' ? r.created_at : new Date()) : new Date()),
          toMySQLTimestamp(Date.now())
        ]
      }));
      queries.push(...category2Queries);

      // Upsert junction table relationships (REQUIRED - no fallback)
      if (junctionTableData && junctionTableData.length > 0) {
        const validJunctionData: Array<{ category2_id: number; business_id: number; created_at?: string | null }> = [];

        // Verify business_id exists before inserting (foreign key constraint)
        for (const rel of junctionTableData) {
          try {
            const businessExists = await executeQueryOne<{ id: number }>('SELECT id FROM businesses WHERE id = ? LIMIT 1', [rel.business_id]);
            if (!businessExists) {
              console.warn(`⚠️ [CATEGORY2 UPSERT] Skipping junction: business_id ${rel.business_id} does not exist`);
              continue;
            }
            validJunctionData.push(rel);
          } catch (checkError) {
            console.warn(`⚠️ [CATEGORY2 UPSERT] Error checking business_id ${rel.business_id}:`, checkError);
            continue;
          }
        }

        if (validJunctionData.length > 0) {
          const junctionQueries = validJunctionData.map(rel => ({
            sql: `
              INSERT INTO category2_businesses (category2_id, business_id, created_at)
              VALUES (?, ?, ?)
              ON DUPLICATE KEY UPDATE created_at=VALUES(created_at)
            `,
            params: [
              typeof rel.category2_id === 'number' ? rel.category2_id : (rel.category2_id ? Number(rel.category2_id) : 0),
              typeof rel.business_id === 'number' ? rel.business_id : (rel.business_id ? Number(rel.business_id) : 0),
              toMySQLTimestamp(rel.created_at ? (typeof rel.created_at === 'number' || typeof rel.created_at === 'string' ? rel.created_at : new Date()) : new Date())
            ]
          }));
          queries.push(...junctionQueries);
          console.log(`✅ [CATEGORY2 UPSERT] Stored ${validJunctionData.length} category2-business relationships (${junctionTableData.length - validJunctionData.length} skipped due to missing businesses)`);
        } else {
          console.warn(`⚠️ [CATEGORY2 UPSERT] No valid junction table data (all ${junctionTableData.length} skipped due to missing businesses)`);
        }
      } else {
        console.warn(`⚠️ [CATEGORY2 UPSERT] No junction table data provided - category2 records will not be associated with any business`);
      }

      await executeTransaction(queries);
      await upsertMasterDataToSystemPos(queries);
      return { success: true };
    } catch (error) {
      console.error('Error upserting category2:', error);
      return { success: false };
    }
  });

  ipcMain.handle('localdb-get-category2', async (event, businessId?: number) => {
    try {
      if (businessId) {
        // Use junction table for multi-business support (junction table only - no fallback)
        return await executeQuery(`
          SELECT DISTINCT c2.*
          FROM category2 c2
          INNER JOIN category2_businesses cb ON c2.id = cb.category2_id
          WHERE c2.is_active = 1 
            AND cb.business_id = ?
          ORDER BY c2.display_order ASC, c2.name ASC
        `, [businessId]);
      } else {
        return await executeQuery('SELECT * FROM category2 WHERE is_active = 1 ORDER BY display_order ASC, name ASC');
      }
    } catch (error) {
      console.error('Error getting category2:', error);
      return [];
    }
  });

  // CL Accounts
  ipcMain.handle('localdb-upsert-cl-accounts', async (event, rows: RowArray) => {
    try {
      const queries = rows.map(r => {
        const getId = () => {
          const val = r.id;
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getString = (key: string) => (typeof r[key] === 'string' ? r[key] as string : null);
        const getNumber = (key: string) => {
          const val = r[key];
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const num = Number(val);
            return isNaN(num) ? null : num;
          }
          return null;
        };
        const getBoolean = (key: string) => {
          const val = r[key];
          if (typeof val === 'boolean') return val;
          if (typeof val === 'number') return val === 1;
          if (typeof val === 'string') return val === 'true' || val === '1';
          return null;
        };
        const getDate = (key: string) => {
          const val = r[key];
          if (val instanceof Date) return val;
          if (typeof val === 'string' || typeof val === 'number') return val;
          return null;
        };
        const createdDate = getDate('created_at');
        const updatedDate = getDate('updated_at');
        const createdAt = createdDate ? toMySQLTimestamp(createdDate as string | number | Date) : toMySQLTimestamp(new Date());
        const updatedAt = updatedDate ? toMySQLTimestamp(updatedDate as string | number | Date) : toMySQLTimestamp(Date.now());
        return {
          sql: `INSERT INTO cl_accounts (
            id, account_code, account_name, contact_info, credit_limit, current_balance,
            is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            account_code=VALUES(account_code), account_name=VALUES(account_name), contact_info=VALUES(contact_info),
            credit_limit=VALUES(credit_limit), current_balance=VALUES(current_balance),
            is_active=VALUES(is_active), created_at=VALUES(created_at), updated_at=VALUES(updated_at)`,
          params: [
            getId(),
            getString('account_code'),
            getString('account_name'),
            getString('contact_info'),
            getNumber('credit_limit') ?? 0.0,
            getNumber('current_balance') ?? 0.0,
            getBoolean('is_active') ? 1 : 0,
            createdAt,
            updatedAt
          ] as (string | number | null | boolean)[]
        };
      });
      await executeTransaction(queries);
      return { success: true };
    } catch (error) {
      console.error('Error upserting CL accounts:', error);
      return { success: false };
    }
  });

  ipcMain.handle('localdb-get-cl-accounts', async () => {
    try {
      return await executeQuery('SELECT * FROM cl_accounts WHERE is_active = 1 ORDER BY account_name ASC');
    } catch (error) {
      console.error('Error getting CL accounts:', error);
      return [];
    }
  });


  // Printer configuration handlers
  ipcMain.handle('localdb-save-printer-config', async (event, printerType: string, systemPrinterName: string, extraSettings?: UnknownRecord | string | null) => {
    try {
      let extraSettingsJson: string | null = null;
      if (extraSettings !== undefined && extraSettings !== null) {
        if (typeof extraSettings === 'string') {
          extraSettingsJson = extraSettings.trim() === '' ? null : extraSettings;
        } else if (typeof extraSettings === 'object') {
          try {
            extraSettingsJson = JSON.stringify(extraSettings);
          } catch (jsonError) {
            console.warn('⚠️ Failed to serialize extraSettings, falling back to null:', jsonError);
            extraSettingsJson = null;
          }
        }
      }

      const now = toMySQLTimestamp(Date.now());
      await executeUpsert(
        `INSERT INTO printer_configs (id, printer_type, system_printer_name, extra_settings, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           system_printer_name = VALUES(system_printer_name),
           extra_settings = VALUES(extra_settings),
           updated_at = VALUES(updated_at)`,
        [printerType, printerType, systemPrinterName, extraSettingsJson, now, now]
      );
      return { success: true };
    } catch (error) {
      console.error('Error saving printer config:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('localdb-get-printer-configs', async () => {
    try {
      return await executeQuery('SELECT * FROM printer_configs ORDER BY printer_type ASC');
    } catch (error) {
      console.error('Error getting printer configs:', error);
      return [];
    }
  });

  // Local settings handlers (NOT synced to server)
  ipcMain.handle('localdb-get-setting', async (event, settingKey: string) => {
    try {
      const result = await executeQueryOne<{ setting_value: string | null }>(
        'SELECT setting_value FROM local_settings WHERE setting_key = ?',
        [settingKey]
      );
      return result?.setting_value || null;
    } catch (error) {
      console.error('Error getting local setting:', error);
      return null;
    }
  });

  ipcMain.handle('localdb-save-setting', async (event, settingKey: string, settingValue: string) => {
    try {
      const now = toMySQLTimestamp(Date.now());
      await executeUpsert(
        `INSERT INTO local_settings (setting_key, setting_value, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           setting_value = VALUES(setting_value),
           updated_at = VALUES(updated_at)`,
        [settingKey, settingValue, now, now]
      );
      return { success: true };
    } catch (error) {
      console.error('Error saving local setting:', error);
      return { success: false, error: String(error) };
    }
  });

  // ==================== PRINTER MANAGEMENT IPC HANDLERS ====================

  // Generate 19-digit numeric UUID
  ipcMain.handle('generate-numeric-uuid', async (event, businessId: number) => {
    if (!printerService) return { success: false, error: 'Printer service not available' };
    try {
      const uuid = await printerService.generateNumericUUID(businessId);
      return { success: true, uuid };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get or increment printer counter
  ipcMain.handle('get-printer-counter', async (event, printerType: string, businessId: number, increment: boolean = false) => {
    if (!printerService) {
      console.error(`❌ [IPC] Printer service not available for getPrinterCounter (${printerType}, businessId: ${businessId}, increment: ${increment})`);
      return { success: false, counter: 0 };
    }
    try {
      const counter = await printerService.getPrinterCounter(printerType, businessId, increment);
      console.log(`📊 [IPC] getPrinterCounter returned: ${counter} (${printerType}, businessId: ${businessId}, increment: ${increment})`);
      return { success: true, counter };
    } catch (error) {
      console.error(`❌ [IPC] Error in getPrinterCounter (${printerType}, businessId: ${businessId}, increment: ${increment}):`, error);
      return { success: false, counter: 0, error: String(error) };
    }
  });

  // Get Printer 2 mode
  ipcMain.handle('get-printer2-mode', async () => {
    if (!printerService) return { success: true, mode: 'manual' as const };
    const mode = printerService.getPrinter2Mode();
    return { success: true, mode };
  });

  // Set Printer 2 mode
  ipcMain.handle('set-printer2-mode', async (event, mode: 'auto' | 'manual') => {
    if (!printerService) return { success: false };
    const result = printerService.setPrinter2Mode(mode);
    return { success: result };
  });

  // Get Printer 2 automation selections
  ipcMain.handle('get-printer2-automation-selections', async (event, businessId: number) => {
    if (!printerService) return { success: false, cycleNumber: 0, selections: [] };
    const result = printerService.getPrinter2AutomationSelections(businessId);
    return { success: true, ...result };
  });

  // Save Printer 2 automation selections
  ipcMain.handle('save-printer2-automation-selections', async (event, businessId: number, cycleNumber: number, selections: number[]) => {
    if (!printerService) return { success: false };
    const result = printerService.savePrinter2AutomationSelections(businessId, cycleNumber, selections);
    return { success: result };
  });

  // Generate random selections
  ipcMain.handle('generate-random-selections', async (event, cycleNumber: number) => {
    if (!printerService) return { success: false, selections: [] };
    const selections = printerService.generateRandomSelections(cycleNumber);
    return { success: true, selections };
  });

  // Log Printer 2 print
  ipcMain.handle('log-printer2-print', async (event, transactionId: string, printer2ReceiptNumber: number, mode: 'auto' | 'manual', cycleNumber?: number, globalCounter?: number, isReprint?: boolean, reprintCount?: number) => {
    if (!printerService) return { success: false };
    const result = await printerService.logPrinter2Print(transactionId, printer2ReceiptNumber, mode, cycleNumber, globalCounter, isReprint, reprintCount);
    return { success: result };
  });

  // Get Printer 2 audit log
  ipcMain.handle('get-printer2-audit-log', async (event, fromDate?: string, toDate?: string, limit?: number, transactionId?: string) => {
    console.log(`📋 [IPC] get-printer2-audit-log called: fromDate=${fromDate}, toDate=${toDate}, limit=${limit}, transactionId=${transactionId ?? 'none'}, printerService=${!!printerService}`);
    if (!printerService) {
      console.log('❌ [IPC] printerService is null!');
      return { success: false, entries: [] };
    }
    const entries = await printerService.getPrinter2AuditLog(fromDate, toDate, limit || 100, transactionId);
    console.log(`📋 [IPC] get-printer2-audit-log returning ${entries.length} entries`);
    return { success: true, entries };
  });

  // Log Printer 1 print
  ipcMain.handle('log-printer1-print', async (event, transactionId: string, printer1ReceiptNumber: number, globalCounter?: number, isReprint?: boolean, reprintCount?: number) => {
    if (!printerService) return { success: false };
    const result = await printerService.logPrinter1Print(transactionId, printer1ReceiptNumber, globalCounter, isReprint, reprintCount);
    return { success: result };
  });

  // Queue transaction for System POS sync (when printed to Printer 2)
  // Only transactions printed on Printer 2 are queued (enforced by PaymentModal / TransactionDetailModal).
  // We queue, then immediately insert into system_pos.transactions and mark synced/failed.
  ipcMain.handle('queue-transaction-for-system-pos', async (event, transactionId: string) => {
    console.log(`🔌 [IPC] queue-transaction-for-system-pos called for ${transactionId}`);
    try {
      await ensureSystemPosSchema();
      const now = Date.now();
      await executeSystemPosTransaction([
        {
          sql: 'INSERT IGNORE INTO system_pos_queue (transaction_id, queued_at) VALUES (?, ?)',
          params: [transactionId, now]
        }
      ]);

      const insertResult = await insertTransactionToSystemPos(transactionId);
      if (!insertResult.success) {
        await executeSystemPosUpdate(
          'UPDATE system_pos_queue SET retry_count = retry_count + 1, last_error = ? WHERE transaction_id = ?',
          [(insertResult.error ?? 'Unknown error').substring(0, 500), transactionId]
        );
        console.error(`❌ [SYSTEM POS] Failed to insert transaction ${transactionId} into system_pos:`, insertResult.error);
        writeSystemPosDebugLog({
          source: 'bayar_konfirmasi',
          transactionId,
          reason: insertResult.error ?? 'Unknown error'
        });
        return { success: false, error: insertResult.error };
      }

      await executeSystemPosUpdate('UPDATE system_pos_queue SET synced_at = ? WHERE transaction_id = ?', [now, transactionId]);
      console.log(`✅ [SYSTEM POS] Queued and inserted transaction ${transactionId} into system_pos${insertResult.skipped ? ' (already existed)' : ''}`);
      return { success: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      console.error('❌ [SYSTEM POS] Error queueing transaction:', error);
      writeSystemPosDebugLog({
        source: 'bayar_konfirmasi',
        transactionId,
        reason: errMsg,
        stack: errStack
      });
      return { success: false, error: errMsg };
    }
  });

  // Get queued transactions for System POS sync
  ipcMain.handle('get-system-pos-queue', async () => {
    try {
      // Get ALL queue entries (not just pending) for status checking
      const allQueue = await executeSystemPosQuery<{
        id: number;
        transaction_id: string;
        queued_at: number;
        synced_at: number | null;
        retry_count: number;
        last_error: string | null;
      }>('SELECT id, transaction_id, queued_at, synced_at, retry_count, last_error FROM system_pos_queue ORDER BY queued_at DESC');
      return { success: true, queue: allQueue };
    } catch (error) {
      console.error('❌ [SYSTEM POS] Error getting queue:', error);
      return { success: false, queue: [] };
    }
  });

  // Mark transaction as synced in System POS queue
  ipcMain.handle('mark-system-pos-synced', async (event, transactionId: string) => {
    try {
      const now = Date.now();
      await executeSystemPosUpdate('UPDATE system_pos_queue SET synced_at = ? WHERE transaction_id = ?', [now, transactionId]);
      console.log(`✅ [SYSTEM POS] Marked transaction ${transactionId} as synced`);
      return { success: true };
    } catch (error) {
      console.error('❌ [SYSTEM POS] Error marking as synced:', error);
      return { success: false };
    }
  });

  // Mark transaction sync failed (increment retry count)
  ipcMain.handle('mark-system-pos-failed', async (event, transactionId: string, error: string) => {
    try {
      await executeSystemPosUpdate('UPDATE system_pos_queue SET retry_count = retry_count + 1, last_error = ? WHERE transaction_id = ?', [error.substring(0, 500), transactionId]);
      console.log(`⚠️ [SYSTEM POS] Marked transaction ${transactionId} sync as failed (retry count incremented)`);
      return { success: true };
    } catch (error) {
      console.error('❌ [SYSTEM POS] Error marking as failed:', error);
      return { success: false };
    }
  });

  // Reset retry count for system-pos transactions (for retrying failed transactions)
  ipcMain.handle('reset-system-pos-retry-count', async (event, transactionIds?: string[]) => {
    try {
      if (transactionIds && transactionIds.length > 0) {
        // Reset specific transactions
        const placeholders = transactionIds.map(() => '?').join(',');
        const affectedRows = await executeSystemPosUpdate(`UPDATE system_pos_queue SET retry_count = 0, last_error = NULL WHERE transaction_id IN (${placeholders})`, transactionIds);
        console.log(`[SYSTEM POS] Reset retry count for ${affectedRows} transaction(s)`);
        return { success: true, count: affectedRows };
      } else {
        // Reset all failed transactions (retry_count >= 5)
        const affectedRows = await executeSystemPosUpdate('UPDATE system_pos_queue SET retry_count = 0, last_error = NULL WHERE retry_count >= 5', []);
        console.log(`[SYSTEM POS] Reset retry count for ${affectedRows} failed transaction(s)`);
        return { success: true, count: affectedRows };
      }
    } catch (error) {
      console.error('[SYSTEM POS] Error resetting retry count:', error);
      return { success: false };
    }
  });

  // Debug: Check transaction sync status for System POS
  ipcMain.handle('debug-system-pos-transaction', async (event, transactionId: string) => {
    try {
      // Check if transaction exists in local DB
      const transaction = await executeQueryOne<{
        id: string;
        business_id: number;
        user_id: number;
        created_at: string;
        synced_at: number | null;
      }>('SELECT id, business_id, user_id, created_at, synced_at FROM transactions WHERE id = ?', [transactionId]);

      // Check queue status (in system_pos database)
      const queueEntry = await executeSystemPosQueryOne<{
        id: number;
        transaction_id: string;
        queued_at: number;
        synced_at: number | null;
        retry_count: number;
        last_error: string | null;
      }>('SELECT id, transaction_id, queued_at, synced_at, retry_count, last_error FROM system_pos_queue WHERE transaction_id = ?', [transactionId]);

      return {
        success: true,
        transaction: transaction || null,
        queue: queueEntry || null,
        existsInDatabase: !!transaction,
        isQueued: !!queueEntry,
        isSynced: queueEntry?.synced_at !== null,
        retryCount: queueEntry?.retry_count || 0,
        lastError: queueEntry?.last_error || null,
      };
    } catch (error) {
      console.error('❌ [SYSTEM POS DEBUG] Error checking transaction:', error);
      return { success: false, error: String(error) };
    }
  });

  // Repopulate System POS queue (Force Resync)
  // Only queues transactions that have a printer2_audit_log entry (i.e. printed on Printer 2).
  ipcMain.handle('repopulate-system-pos-queue', async (event, options: { days?: number } = {}) => {
    try {
      const { days } = options;
      console.log(`[SYSTEM POS] Repopulating queue (days: ${days || 'ALL'}, Printer 2 only)...`);

      let query = `
        SELECT DISTINCT t.uuid_id, t.created_at
        FROM transactions t
        INNER JOIN printer2_audit_log p2 ON p2.transaction_id = t.uuid_id
      `;
      const params: (string | number | null | boolean)[] = [];

      if (days && days > 0) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        query += ' WHERE t.created_at >= ?';
        params.push(toMySQLDateTime(cutoffDate));
      }

      query += ' ORDER BY t.created_at DESC';

      const transactions = await executeQuery<{ uuid_id: string; created_at: string }>(query, params);

      if (transactions.length === 0) {
        return { success: true, count: 0, message: 'No Printer 2 transactions found in the specified period' };
      }

      console.log(`[SYSTEM POS] Found ${transactions.length} Printer 2 transactions to process`);

      const now = Date.now();
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];

      for (const tx of transactions) {
        const transactionId = tx.uuid_id;
        // Insert or ignore
        queries.push({
          sql: 'INSERT IGNORE INTO system_pos_queue (transaction_id, queued_at) VALUES (?, ?)',
          params: [transactionId, now]
        });
        // Always reset status to ensure partial syncs are fixed
        queries.push({
          sql: 'UPDATE system_pos_queue SET synced_at = NULL, retry_count = 0, last_error = NULL WHERE transaction_id = ?',
          params: [transactionId]
        });
      }

      await executeSystemPosTransaction(queries);

      let inserted = 0;
      let failed = 0;
      for (const tx of transactions) {
        const transactionId = tx.uuid_id;
        const insertResult = await insertTransactionToSystemPos(transactionId);
        if (insertResult.success) {
          await executeSystemPosUpdate('UPDATE system_pos_queue SET synced_at = ? WHERE transaction_id = ?', [now, transactionId]);
          inserted++;
        } else {
          await executeSystemPosUpdate(
            'UPDATE system_pos_queue SET retry_count = retry_count + 1, last_error = ? WHERE transaction_id = ?',
            [(insertResult.error ?? 'Unknown').substring(0, 500), transactionId]
          );
          writeSystemPosDebugLog({
            source: 'repopulate',
            transactionId,
            reason: insertResult.error ?? 'Unknown error'
          });
          failed++;
        }
      }

      console.log(`[SYSTEM POS] Queued and processed ${transactions.length} Printer 2 transactions (inserted: ${inserted}, failed: ${failed})`);
      return { success: true, count: transactions.length, inserted, failed };
    } catch (error) {
      console.error('[SYSTEM POS] Error repopulating queue:', error);
      return { success: false, error: String(error) };
    }
  });

  // Manual System POS Re-sync: preview count of Printer 2 transactions in date range (by printed_at)
  ipcMain.handle('get-system-pos-resync-preview', async (event, fromDate: string, toDate: string) => {
    try {
      if (!fromDate || !toDate) {
        return { success: false, error: 'fromDate and toDate are required (YYYY-MM-DD)', count: 0 };
      }
      const [yFrom, mFrom, dFrom] = fromDate.split('-').map(Number);
      const [yTo, mTo, dTo] = toDate.split('-').map(Number);
      const fromEpoch = new Date(yFrom, mFrom - 1, dFrom, 0, 0, 0, 0).getTime();
      const toEpoch = new Date(yTo, mTo - 1, dTo, 23, 59, 59, 999).getTime();
      if (fromEpoch > toEpoch) {
        return { success: false, error: 'fromDate must be before or equal to toDate', count: 0 };
      }
      const rows = await executeQuery<{ transaction_id: string }>(
        `SELECT DISTINCT transaction_id FROM printer2_audit_log
         WHERE printed_at_epoch >= ? AND printed_at_epoch <= ?
         ORDER BY transaction_id`,
        [fromEpoch, toEpoch]
      );
      const transactionIds = rows.map(r => r.transaction_id);
      console.log(`[SYSTEM POS] Preview: ${transactionIds.length} Printer 2 transactions in ${fromDate}..${toDate}`);
      return { success: true, count: transactionIds.length, transactionIds };
    } catch (error) {
      console.error('[SYSTEM POS] Error getting resync preview:', error);
      return { success: false, error: String(error), count: 0 };
    }
  });

  // Manual System POS Re-sync: sync Printer 2 transactions in date range to system_pos
  ipcMain.handle('run-system-pos-resync', async (event, fromDate: string, toDate: string) => {
    try {
      if (!fromDate || !toDate) {
        return { success: false, error: 'fromDate and toDate are required (YYYY-MM-DD)', count: 0, synced: 0, failed: 0, errors: [] };
      }
      const [yFrom, mFrom, dFrom] = fromDate.split('-').map(Number);
      const [yTo, mTo, dTo] = toDate.split('-').map(Number);
      const fromEpoch = new Date(yFrom, mFrom - 1, dFrom, 0, 0, 0, 0).getTime();
      const toEpoch = new Date(yTo, mTo - 1, dTo, 23, 59, 59, 999).getTime();
      if (fromEpoch > toEpoch) {
        return { success: false, error: 'fromDate must be before or equal to toDate', count: 0, synced: 0, failed: 0, errors: [] };
      }
      const transactions = await executeQuery<{ transaction_id: string }>(
        `SELECT DISTINCT transaction_id FROM printer2_audit_log
         WHERE printed_at_epoch >= ? AND printed_at_epoch <= ?
         ORDER BY transaction_id`,
        [fromEpoch, toEpoch]
      );
      if (transactions.length === 0) {
        return { success: true, count: 0, synced: 0, failed: 0, errors: [], message: 'No Printer 2 transactions in date range' };
      }
      console.log(`[SYSTEM POS] Manual re-sync: ${transactions.length} Printer 2 transactions (${fromDate}..${toDate})`);
      const now = Date.now();
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];
      for (const tx of transactions) {
        const transactionId = tx.transaction_id;
        queries.push({
          sql: 'INSERT IGNORE INTO system_pos_queue (transaction_id, queued_at) VALUES (?, ?)',
          params: [transactionId, now]
        });
        queries.push({
          sql: 'UPDATE system_pos_queue SET synced_at = NULL, retry_count = 0, last_error = NULL WHERE transaction_id = ?',
          params: [transactionId]
        });
      }
      await executeSystemPosTransaction(queries);
      let synced = 0;
      let failed = 0;
      const errors: Array<{ transactionId: string; error: string }> = [];
      for (const tx of transactions) {
        const transactionId = tx.transaction_id;
        const insertResult = await insertTransactionToSystemPos(transactionId);
        if (insertResult.success) {
          await executeSystemPosUpdate('UPDATE system_pos_queue SET synced_at = ? WHERE transaction_id = ?', [now, transactionId]);
          synced++;
        } else {
          const errMsg = (insertResult.error ?? 'Unknown').substring(0, 500);
          await executeSystemPosUpdate(
            'UPDATE system_pos_queue SET retry_count = retry_count + 1, last_error = ? WHERE transaction_id = ?',
            [errMsg, transactionId]
          );
          writeSystemPosDebugLog({ source: 'manual-resync', transactionId, reason: insertResult.error ?? 'Unknown error' });
          failed++;
          errors.push({ transactionId, error: errMsg });
        }
      }
      console.log(`[SYSTEM POS] Manual re-sync done: ${synced} synced, ${failed} failed`);
      return { success: true, count: transactions.length, synced, failed, errors };
    } catch (error) {
      console.error('[SYSTEM POS] Error running manual resync:', error);
      return { success: false, error: String(error), count: 0, synced: 0, failed: 0, errors: [] };
    }
  });

  // Upsert master data (products + categories) from salespulse to system_pos. Call after "Download master data".
  ipcMain.handle('upsert-master-data-to-system-pos', async () => {
    try {
      const result = await upsertProductsFromMainToSystemPos();
      return result;
    } catch (error) {
      console.error('[SYSTEM POS] upsert-master-data-to-system-pos failed:', error);
      return { success: false, upserted: 0, error: String(error) };
    }
  });

  // Auto re-sync refunded Printer 2 transactions to system_pos. Called during Smart Sync cycle.
  ipcMain.handle('sync-refunded-transactions-to-system-pos', async () => {
    try {
      await ensureSystemPosSchema();
      const result = await syncRefundedTransactionsToSystemPos();
      return result;
    } catch (error) {
      console.error('[SYSTEM POS] sync-refunded-transactions-to-system-pos failed:', error);
      return { success: false, syncedCount: 0, error: String(error) };
    }
  });

  // Get Printer 1 audit log
  ipcMain.handle('get-printer1-audit-log', async (event, fromDate?: string, toDate?: string, limit?: number, transactionId?: string) => {
    console.log(`[IPC] get-printer1-audit-log called: fromDate=${fromDate}, toDate=${toDate}, limit=${limit}, transactionId=${transactionId ?? 'none'}, printerService=${!!printerService}`);
    if (!printerService) {
      console.log('[IPC] printerService is null!');
      return { success: false, entries: [] };
    }
    const entries = await printerService.getPrinter1AuditLog(fromDate, toDate, limit || 100, transactionId);
    console.log(`[IPC] get-printer1-audit-log returning ${entries.length} entries`);
    return { success: true, entries };
  });

  // Move transaction from Printer 1 audit log to Printer 2 audit log
  ipcMain.handle('move-transaction-to-printer2', async (event, transactionId: string) => {
    console.log(`📋 [IPC] move-transaction-to-printer2 called: transactionId=${transactionId}, printerService=${!!printerService}`);
    if (!printerService) {
      console.log('❌ [IPC] printerService is null!');
      return { success: false, error: 'Printer service not available' };
    }

    // Get business ID from the transaction
    try {
      const transaction = await executeQueryOne<{ business_id: number }>(
        'SELECT business_id FROM transactions WHERE id = ? OR uuid_id = ? LIMIT 1',
        [transactionId, transactionId]
      );

      if (!transaction || !transaction.business_id) {
        console.error(`❌ Transaction ${transactionId} not found or has no business_id`);
        return { success: false, error: 'Transaction not found or has no business ID' };
      }

      const result = await printerService.moveTransactionToPrinter2(transactionId, transaction.business_id);

      if (result) {
        // Queue transaction for System POS sync
        try {
          const queueResult = await insertTransactionToSystemPos(transactionId);
          if (queueResult.success) {
            console.log(`✅ [SYSTEM POS] Transaction ${transactionId} queued for System POS sync`);
          } else if (queueResult.skipped) {
            console.log(`✅ [SYSTEM POS] Transaction ${transactionId} already exists in system_pos`);
          } else {
            console.warn(`⚠️ [SYSTEM POS] Failed to queue transaction ${transactionId}:`, queueResult.error);
            writeSystemPosDebugLog({
              source: 'move_to_printer2',
              transactionId,
              reason: queueResult.error ?? 'Unknown error'
            });
          }
        } catch (queueError) {
          const errMsg = queueError instanceof Error ? queueError.message : String(queueError);
          const errStack = queueError instanceof Error ? queueError.stack : undefined;
          console.error('❌ [SYSTEM POS] Error queueing transaction for System POS:', queueError);
          writeSystemPosDebugLog({
            source: 'move_to_printer2',
            transactionId,
            reason: errMsg,
            stack: errStack
          });
          // Don't fail the move operation if System POS queue fails
        }
      }

      return { success: result, error: result ? undefined : 'Failed to move transaction' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ [IPC] Error moving transaction to Printer 2:`, error);
      return { success: false, error: errorMessage };
    }
  });

  // Get unsynced printer audits (both tables)
  ipcMain.handle('localdb-get-unsynced-printer-audits', async () => {
    try {
      // Get unsynced printer1 audits (where synced_at IS NULL)
      const p1Audits = await executeQuery<unknown[]>(`
        SELECT * FROM printer1_audit_log 
        WHERE synced_at IS NULL 
        ORDER BY printed_at_epoch ASC
        LIMIT 100
      `);

      // Get unsynced printer2 audits (where synced_at IS NULL)
      const p2Audits = await executeQuery<unknown[]>(`
        SELECT * FROM printer2_audit_log 
        WHERE synced_at IS NULL 
        ORDER BY printed_at_epoch ASC
        LIMIT 100
      `);

      return { p1: p1Audits, p2: p2Audits };
    } catch (error) {
      console.error('Error getting unsynced printer audits:', error);
      return { p1: [], p2: [] };
    }
  });



  // Mark printer audits as synced
  ipcMain.handle('localdb-mark-printer-audits-synced', async (event, ids: { p1Ids: number[]; p2Ids: number[] }) => {
    try {
      const now = Date.now();
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];

      if (ids?.p1Ids?.length) {
        const placeholders = ids.p1Ids.map(() => '?').join(',');
        queries.push({
          sql: `UPDATE printer1_audit_log SET synced_at = ? WHERE id IN (${placeholders})`,
          params: [toMySQLDateTime(now), ...ids.p1Ids]
        });
      }
      if (ids?.p2Ids?.length) {
        const placeholders = ids.p2Ids.map(() => '?').join(',');
        queries.push({
          sql: `UPDATE printer2_audit_log SET synced_at = ? WHERE id IN (${placeholders})`,
          params: [toMySQLDateTime(now), ...ids.p2Ids]
        });
      }

      if (queries.length > 0) {
        await executeTransaction(queries);
      }
      return { success: true };
    } catch (error) {
      console.error('Error marking printer audits synced:', error);
      return { success: false };
    }
  });

  // Upsert printer audit logs downloaded from cloud
  ipcMain.handle('localdb-upsert-printer-audits', async (event, payload: { printerType: 'receipt' | 'receiptize'; rows: RowArray }) => {
    if (!payload?.rows?.length) return { success: true, count: 0 };

    const now = Date.now();
    const { printerType, rows } = payload;

    try {
      const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];

      const parsePrintedAt = (value: unknown): number => {
        if (typeof value === 'string' || typeof value === 'number') {
          const date = new Date(value);
          if (!Number.isNaN(date.getTime())) {
            return date.getTime();
          }
        }
        return 0;
      };

      if (printerType === 'receipt') {
        for (const row of rows) {
          const transactionId = String(row.transaction_id);
          const receiptNumber = Number(row.printer1_receipt_number);
          const printedAtEpoch = Number(row.printed_at_epoch ?? parsePrintedAt(row.printed_at));
          if (!transactionId || Number.isNaN(receiptNumber) || Number.isNaN(printedAtEpoch)) {
            continue;
          }

          // Delete existing record
          queries.push({
            sql: 'DELETE FROM printer1_audit_log WHERE transaction_id = ? AND printer1_receipt_number = ? AND printed_at_epoch = ?',
            params: [transactionId, receiptNumber, printedAtEpoch]
          });

          // Insert new record
          queries.push({
            sql: `
              INSERT INTO printer1_audit_log (transaction_id, printer1_receipt_number, global_counter, printed_at, printed_at_epoch, synced_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `,
            params: [
              transactionId,
              receiptNumber,
              typeof row.global_counter === 'number' ? row.global_counter : null,
              row.printed_at ? toMySQLDateTime(typeof row.printed_at === 'number' || typeof row.printed_at === 'string' ? row.printed_at : new Date(printedAtEpoch)) : toMySQLDateTime(new Date(printedAtEpoch)),
              printedAtEpoch,
              now
            ]
          });
        }
      } else {
        for (const row of rows) {
          const transactionId = String(row.transaction_id);
          const receiptNumber = Number(row.printer2_receipt_number);
          const printedAtEpoch = Number(row.printed_at_epoch ?? parsePrintedAt(row.printed_at));
          if (!transactionId || Number.isNaN(receiptNumber) || Number.isNaN(printedAtEpoch)) {
            continue;
          }

          // Delete existing record
          queries.push({
            sql: 'DELETE FROM printer2_audit_log WHERE transaction_id = ? AND printer2_receipt_number = ? AND printed_at_epoch = ?',
            params: [transactionId, receiptNumber, printedAtEpoch]
          });

          // Insert new record
          queries.push({
            sql: `
              INSERT INTO printer2_audit_log (transaction_id, printer2_receipt_number, print_mode, cycle_number, global_counter, printed_at, printed_at_epoch, synced_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            params: [
              transactionId,
              receiptNumber,
              typeof row.print_mode === 'string' ? row.print_mode : 'manual',
              typeof row.cycle_number === 'number' ? row.cycle_number : null,
              typeof row.global_counter === 'number' ? row.global_counter : null,
              row.printed_at ? toMySQLDateTime(typeof row.printed_at === 'number' || typeof row.printed_at === 'string' ? row.printed_at : new Date(printedAtEpoch)) : toMySQLDateTime(new Date(printedAtEpoch)),
              printedAtEpoch,
              now
            ]
          });
        }
      }

      if (queries.length > 0) {
        await executeTransaction(queries);
      }
      return { success: true, count: rows.length };
    } catch (error) {
      console.error('Error upserting printer audits:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get all printer daily counters
  ipcMain.handle('localdb-get-all-printer-daily-counters', async () => {
    try {
      return await executeQuery<{ printer_type: string; business_id: number; date: string; counter: number }>('SELECT printer_type, business_id, date, counter FROM printer_daily_counters ORDER BY business_id, printer_type, date');
    } catch (error) {
      console.error('Error getting printer daily counters:', error);
      return [];
    }
  });

  // Upsert printer daily counters downloaded from cloud


  ipcMain.handle('localdb-upsert-printer-daily-counters', async (event, counters: Array<{ printer_type: string; business_id: number; date: string; counter: number }>) => {
    if (!Array.isArray(counters) || counters.length === 0) {
      return { success: true, count: 0 };
    }

    try {
      const now = Date.now();
      const queries = counters
        .filter(row => row?.printer_type && row?.date)
        .map(row => ({
          sql: `
            INSERT INTO printer_daily_counters (printer_type, business_id, date, counter, last_reset_at)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE counter = VALUES(counter), last_reset_at = VALUES(last_reset_at)
          `,
          params: [
            row.printer_type,
            Number(row.business_id ?? 0),
            row.date,
            Number(row.counter ?? 0),
            now
          ]
        }));

      if (queries.length > 0) {
        await executeTransaction(queries);
      }
      return { success: true, count: counters.length };
    } catch (error) {
      console.error('Error upserting printer counters:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('localdb-reset-printer-daily-counters', async (event, businessId: number) => {
    try {
      await executeUpdate(`
        DELETE FROM printer_daily_counters
        WHERE business_id = ?
      `, [businessId]);
      console.log(`[RESET] Cleared printer_daily_counters for business ${businessId}`);
      return { success: true };
    } catch (error) {
      console.error('[RESET] Failed to clear printer_daily_counters:', error);
      return { success: false, error: String(error) };
    }
  });

  // Mark transaction as failed (for transactions table)
  ipcMain.handle('localdb-mark-transaction-failed', async (event, transactionId: string) => {
    try {
      const now = Date.now();
      // CRITICAL FIX: Use uuid_id instead of id, because smart sync passes UUID strings
      await executeUpdate(`
        UPDATE transactions 
        SET sync_status = 'failed', sync_attempts = sync_attempts + 1, last_sync_attempt = ?
        WHERE uuid_id = ?
      `, [now, transactionId]);
      console.log(`[MARK FAILED] Marked transaction ${transactionId} as failed`);
      return { success: true };
    } catch (error) {
      console.error('Error marking transaction as failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('localdb-queue-offline-refund', async (event, refundData: UnknownRecord) => {
    try {
      const connection = await getConnection();
      try {
        // Convert timestamp to MySQL DATETIME format (YYYY-MM-DD HH:MM:SS)
        const mysqlDateTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const [result] = await connection.query(`
          INSERT INTO offline_refunds (refund_data, created_at, sync_status, sync_attempts)
          VALUES (?, ?, 'pending', 0)
        `, [JSON.stringify(refundData), mysqlDateTime]) as any;
        return { success: true, offlineRefundId: result.insertId };
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error queueing offline refund:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('localdb-get-pending-refunds', async () => {
    try {
      return await executeQuery(`
        SELECT id, refund_data, created_at, sync_attempts, last_sync_attempt
        FROM offline_refunds
        WHERE sync_status = 'pending'
        ORDER BY created_at ASC
        LIMIT 50
      `);
    } catch (error) {
      // Table doesn't exist - return empty array instead of error
      const err = error as { code?: string; errno?: number };
      if (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146) {
        console.warn('⚠️ [REFUNDS] offline_refunds table does not exist - returning empty array');
        return [];
      }
      console.error('Error getting pending refunds:', error);
      return [];
    }
  });

  ipcMain.handle('localdb-mark-refund-synced', async (event, offlineRefundId: number) => {
    try {
      // Convert timestamp to MySQL DATETIME format (YYYY-MM-DD HH:MM:SS)
      const mysqlDateTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
      await executeUpdate(`
        UPDATE offline_refunds
        SET sync_status = 'synced', last_sync_attempt = ?
        WHERE id = ?
      `, [mysqlDateTime, offlineRefundId]);
      return { success: true };
    } catch (error) {
      console.error('Error marking refund as synced:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('localdb-mark-refund-failed', async (event, offlineRefundId: number) => {
    try {
      // Convert timestamp to MySQL DATETIME format (YYYY-MM-DD HH:MM:SS)
      const mysqlDateTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
      await executeUpdate(`
        UPDATE offline_refunds
        SET sync_attempts = sync_attempts + 1, last_sync_attempt = ?
        WHERE id = ?
      `, [mysqlDateTime, offlineRefundId]);
      return { success: true };
    } catch (error) {
      console.error('Error marking refund as failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('localdb-check-transaction-exists', async (_event, transactionUuid: string) => {
    try {
      if (!transactionUuid || typeof transactionUuid !== 'string') {
        return { exists: false, error: 'transactionUuid required' };
      }
      const rows = await executeQuery<{ n: number }>(
        'SELECT 1 as n FROM transactions WHERE uuid_id = ? LIMIT 1',
        [transactionUuid]
      );
      const exists = Array.isArray(rows) && rows.length > 0;
      return { exists };
    } catch (error) {
      console.error('Error checking transaction exists:', error);
      return { exists: false, error: String(error) };
    }
  });

  ipcMain.handle('localdb-delete-refund', async (_event, offlineRefundId: number) => {
    try {
      if (!offlineRefundId || typeof offlineRefundId !== 'number') {
        return { success: false, error: 'offlineRefundId required' };
      }
      await executeUpdate('DELETE FROM offline_refunds WHERE id = ?', [offlineRefundId]);
      return { success: true };
    } catch (error) {
      console.error('Error deleting refund:', error);
      return { success: false, error: String(error) };
    }
  });

  // Load the app - start with login page
  console.log('🔍 isDev:', isDev);
  if (isDev) {
    console.log('🔍 Development mode detected');
    // Wait a bit for Next.js to start, then load the login page
    setTimeout(async () => {
      console.log('🔍 Loading login page...');
      // Try to use the port specified in env (PORT from npm script), fall back to defaults
      const tryLoadURL = async (port: number) => {
        try {
          await mainWindow!.loadURL(`http://localhost:${port}/login`);
          console.log(`Successfully loaded login page on port ${port}`);
          return true;
        } catch (error) {
          console.log(`Failed to load on port ${port}:`, error);
          return false;
        }
      };

      const preferredPort = Number(process.env.PORT ?? '');
      const fallbackPorts = [3000, 3001, 3002];
      const ports = [
        ...(Number.isFinite(preferredPort) ? [preferredPort] : []),
        ...fallbackPorts
      ].filter((port, index, arr) => arr.indexOf(port) === index);
      let loaded = false;

      for (const port of ports) {
        if (await tryLoadURL(port)) {
          loaded = true;
          break;
        }
      }

      if (!loaded) {
        console.error('Failed to load on any port');
      }
    }, 5000); // Wait longer for Next.js to be ready
  } else {
    // In production, load the built Next.js app
    const indexPath = path.join(__dirname, '../../out/index.html');
    console.log('🔍 Loading production index file from:', indexPath);
    mainWindow!.loadFile(indexPath);
  }

  // Show windows when ready
  mainWindow!.once('ready-to-show', () => {
    mainWindow!.show();

    // Always focus on the window (fixes Windows 11 frameless window focus issues)
    mainWindow!.focus();
  });

  if (customerWindow) {
    customerWindow.once('ready-to-show', () => {
      customerWindow!.setFullScreen(true);
      customerWindow!.show();
    });
  }

  // Handle window closed
  mainWindow!.on('closed', () => {
    mainWindow = null;
    if (customerWindow) {
      customerWindow.close();
      customerWindow = null;
    }
  });

  if (customerWindow) {
    customerWindow.on('closed', () => {
      customerWindow = null;
    });
  }

  // Create application menu
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Order',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-new-order');
            }
          },
        },
        {
          label: 'Close',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            if (mainWindow) {
              mainWindow.close();
            }
          },
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  // Register custom protocol handler for slideshow images
  protocol.registerFileProtocol('slideshow-file', (request, callback) => {
    try {
      const url = request.url.replace('slideshow-file://', '');
      const slideshowPath = getSlideshowPath();
      const filePath = path.join(slideshowPath, url);

      // Security check: ensure file is within slideshow directory
      const normalizedPath = path.normalize(filePath);
      const normalizedSlideshowPath = path.normalize(slideshowPath);

      if (!normalizedPath.startsWith(normalizedSlideshowPath)) {
        console.error('❌ Security: Attempted to access file outside slideshow directory');
        callback({ error: -10 }); // ACCESS_DENIED
        return;
      }

      if (fs.existsSync(filePath)) {
        callback({ path: filePath });
      } else {
        console.error('❌ Slideshow image not found:', filePath);
        callback({ error: -6 }); // FILE_NOT_FOUND
      }
    } catch (error) {
      console.error('❌ Error handling slideshow-file protocol:', error);
      callback({ error: -2 }); // FAILED
    }
  });

  // Serve product/business images from userData (downloaded during sync)
  protocol.registerFileProtocol('pos-image', (request, callback) => {
    try {
      // Parse pos-image://images/products/filename.webp
      // The URL parser treats "images" as hostname, so we need to combine hostname + pathname
      const url = new URL(request.url);
      const hostname = url.hostname || ''; // "images" in pos-image://images/products/...
      const pathname = decodeURIComponent(url.pathname); // "/products/filename.webp"
      // Combine: hostname (images) + pathname (/products/filename.webp) = images/products/filename.webp
      const fullPath = hostname ? `${hostname}${pathname}` : pathname;
      const parts = fullPath.split('/').filter(Boolean);
      if (parts.length !== 3 || parts[0] !== 'images' || (parts[1] !== 'products' && parts[1] !== 'businesses') || !/^[^/\\]+\.(webp|png|jpg|jpeg|gif)$/i.test(parts[2])) {
        callback({ error: -2 });
        return;
      }
      const userData = app.getPath('userData');
      const localPath = path.join(userData, 'images', parts[1], parts[2]);
      const normalized = path.normalize(localPath);
      if (!normalized.startsWith(path.normalize(path.join(userData, 'images')))) {
        callback({ error: -10 });
        return;
      }
      if (fs.existsSync(localPath)) {
        callback({ path: localPath });
      } else {
        callback({ error: -6 });
      }
    } catch (error) {
      callback({ error: -2 });
    }
  });

  createWindows();

  app.on('activate', () => {
    // On macOS, re-create windows when the dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindows();
    }
  });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  // On macOS, keep the app running even when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});


// IPC handlers for POS-specific functionality
ipcMain.handle('print-receipt', async (event, data: ReceiptPrintData) => {
  // #region agent log
  fetch('http://127.0.0.1:7245/ingest/519de021-d49d-473f-a8a1-4215977c867a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'main.ts:print-receipt', message: 'print operation', data: { operation: 'print-receipt' }, timestamp: Date.now(), hypothesisId: 'count' }) }).catch(() => { });
  // #endregion
  try {
    console.log('📄 Printing receipt - Full data received:', JSON.stringify(data, null, 2));
    console.log(`🔍 [PRINT-RECEIPT] Counter values: printer1Counter=${data.printer1Counter}, printer2Counter=${data.printer2Counter}, globalCounter=${data.globalCounter}, printerType=${data.printerType}`);

    let printerName = data.printerName;
    let marginAdjustMm: number | undefined =
      typeof data.marginAdjustMm === 'number' && !Number.isNaN(data.marginAdjustMm)
        ? data.marginAdjustMm
        : undefined;
    let printerConfig: PrinterConfigRow | null = null;

    if (data.printerType) {
      console.log('🔍 Resolving printer configuration for type:', data.printerType);
      try {
        const allConfigs = await executeQuery<PrinterConfigRow>('SELECT * FROM printer_configs');
        console.log('📋 All printer configs in database:', allConfigs);

        printerConfig = await executeQueryOne<PrinterConfigRow>(
          'SELECT * FROM printer_configs WHERE printer_type = ?',
          [data.printerType]
        ) ?? null;
        console.log('📋 Printer config query result for type', data.printerType, ':', printerConfig);

        if (!printerName && printerConfig && printerConfig.system_printer_name) {
          const configPrinterName = String(printerConfig.system_printer_name).trim();
          if (configPrinterName) {
            printerName = configPrinterName;
            console.log('✅ Found saved printer:', printerName);
          } else {
            console.warn('⚠️ Printer config exists but system_printer_name is empty');
          }
        }

        if (marginAdjustMm === undefined && printerConfig && printerConfig.extra_settings) {
          try {
            const extra =
              typeof printerConfig.extra_settings === 'string'
                ? JSON.parse(printerConfig.extra_settings)
                : printerConfig.extra_settings;
            if (extra && typeof extra.marginAdjustMm === 'number' && !Number.isNaN(extra.marginAdjustMm)) {
              marginAdjustMm = extra.marginAdjustMm;
              console.log('🎚️ Loaded marginAdjustMm from saved settings:', marginAdjustMm);
            }
          } catch (parseError) {
            console.warn('⚠️ Failed to parse extra_settings for printer config:', parseError);
          }
        }

        if (!printerName) {
          // Test-print fallback: use first available physical system printer when Printer 1 (receiptPrinter) not configured
          if (data.type === 'test' && data.printerType === 'receiptPrinter') {
            try {
              const printers = await event.sender.getPrintersAsync();
              // Exclude virtual/document printers so we don't open OneNote, PDF, Fax, XPS, etc.
              const isVirtualPrinter = (n: string) => /pdf|microsoft print to pdf|onenote|fax|xps|send to|document/i.test(n || '');
              const first = printers.find(p => p?.name?.trim() && !isVirtualPrinter(p.name));
              if (first?.name?.trim()) {
                printerName = first.name.trim();
                console.log('🖨️ [TEST PRINT] No Printer 1 configured; using first available (non-virtual):', printerName);
              }
            } catch (e) {
              console.warn('Could not get system printers for test-print fallback:', e);
            }
          }
          if (!printerName || (typeof printerName === 'string' && !printerName.trim())) {
            console.log('⚠️ No system printer configured for type:', data.printerType);
            console.log('💡 Available printer configs:', allConfigs.map(c => ({ type: c.printer_type, name: c.system_printer_name })));
            return { success: false, error: `No printer configured for ${data.printerType}. Please set up a printer in Settings → Printer Selector.` };
          }
        }

        // Validate printer name is not empty after trim
        if (printerName && typeof printerName === 'string' && !printerName.trim()) {
          console.error('❌ Printer name is empty after trim');
          return { success: false, error: `Printer name is empty for ${data.printerType}. Please reconfigure the printer in Settings → Printer Selector.` };
        }
      } catch (error) {
        console.error('❌ Error fetching printer config:', error);
        return { success: false, error: 'Error loading printer configuration.' };
      }
    } else if (!printerName && !data.printerType) {
      console.error('❌ No printerName and no printerType provided!');
      return { success: false, error: 'No printer specified. Please set up a printer in Settings first.' };
    } else if (printerName) {
      console.log('✅ Using provided printer name:', printerName);
    }

    // Validate printerName is a valid string (not printerType identifier)
    if (!printerName || (typeof printerName === 'string' && !printerName.trim())) {
      console.error('❌ No valid printer name found. printerName:', printerName, 'printerType:', data.printerType);
      return { success: false, error: `No printer configured. Please set up a printer in Settings → Printer Selector for ${data.printerType || 'the selected printer type'}.` };
    }

    // Ensure printerName is a string and trimmed
    printerName = String(printerName).trim();

    if (!printerName) {
      console.error('❌ Printer name is empty after validation');
      return { success: false, error: 'No printer specified. Please set up a printer in Settings first.' };
    }

    // Use HTML printing with character-based formatting
    if (printWindow) {
      printWindow.close();
    }

    printWindow = new BrowserWindow({
      width: 400,
      height: 600,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      }
    });

    // Fetch business name from database if business_id is provided
    let businessName = 'Pictos'; // Default fallback
    if (data.business_id) {
      try {
        const business = await executeQueryOne<{ name: string }>(
          'SELECT name FROM businesses WHERE id = ?',
          [data.business_id]
        );
        if (business) {
          businessName = business.name;
          console.log('✅ Fetched business name:', businessName, 'for business_id:', data.business_id);
        } else {
          console.log('⚠️ Business not found for business_id:', data.business_id);
        }
      } catch (error) {
        console.error('❌ Error fetching business name:', error);
      }
    }

    const clampedMarginAdjustMm =
      typeof marginAdjustMm === 'number' && !Number.isNaN(marginAdjustMm)
        ? Math.max(-5, Math.min(5, marginAdjustMm))
        : 0;
    const receiptFormattingOptions = { marginAdjustMm: clampedMarginAdjustMm };

    // Generate receipt HTML with character-based width
    let htmlContent = '';

    if (data.type === 'test' && data.printerType === 'labelPrinter') {
      // Use checker template if available (Template Checker tab), else fallback to built-in test label
      try {
        const checkerResult = await receiptManagementService.getReceiptTemplate('checker', data.business_id);
        if (checkerResult.templateCode && checkerResult.templateCode.trim()) {
          const clampedLabel = Math.max(-5, Math.min(5, marginAdjustMm ?? 0));
          const sampleLabel: LabelPrintData = {
            counter: 1,
            itemNumber: 1,
            totalItems: 2,
            pickupMethod: 'dine-in',
            productName: 'Test Item (Checker Template)',
            customizations: 'Sample customization',
            orderTime: new Date().toISOString(),
            labelContinuation: '',
            leftPadding: (7 - clampedLabel).toFixed(2),
            rightPadding: (7 + clampedLabel).toFixed(2)
          };
          htmlContent = generateLabelHTMLFromTemplate(checkerResult.templateCode.trim(), sampleLabel);
        } else {
          htmlContent = generateTestLabelHTML(printerName);
        }
      } catch (e) {
        console.warn('⚠️ Checker template load failed for test label:', e);
        htmlContent = generateTestLabelHTML(printerName);
      }
    } else {
      // Use template + receipt_settings (pengaturan konten) for both test and real receipts
      try {
        // Determine if this is a bill or receipt, and fetch appropriate template
        const isBill = data.isBill === true;
        const templateType = isBill ? 'bill' : 'receipt';
        const templateResult = await receiptManagementService.getReceiptTemplate(templateType, data.business_id);
        let templateCode = templateResult.templateCode;
        // Notes only on printed checker and dapur/barista; never on customer receipt or bill
        const showNotes = false;
        // Inject voucher block for both bill and receipt templates when voucher is applied
        const hasVoucher = typeof data.voucherDiscount === 'number' && data.voucherDiscount > 0;
        if (templateCode && hasVoucher && !templateCode.includes('{{#ifVoucher}}')) {
          const voucherBlock = `
  {{#ifVoucher}}
  <div class="summary-line">
    <span class="summary-label">Diskon ({{voucherLabel}}):</span>
    <span class="summary-value">-{{voucherDiscount}}</span>
  </div>
  <div class="summary-line">
    <span class="summary-label">Total Bayar:</span>
    <span class="summary-value">{{finalAmount}}</span>
  </div>
  {{/ifVoucher}}
`;
          templateCode = templateCode.replace(
            /(<span class="summary-value">\{\{total\}\}<\/span>\s*<\/div>)\s*(<div class="dashed-line">)/,
            `$1${voucherBlock}\n  $2`
          );
          if (templateCode.includes('{{#ifVoucher}}')) {
            console.log(`✅ Injected {{#ifVoucher}} block into ${templateType} template`);
          }
        }

        if (templateCode) {
          console.log(`✅ Using ${templateType} template from database for printing`);

          // Fetch receipt settings (pengaturan konten) so test and real prints use saved content
          const receiptSettings = await receiptManagementService.getReceiptSettings(data.business_id);
          const displayBusinessName = (receiptSettings?.store_name?.trim() || businessName).trim() || businessName;

          // Generate items HTML string (package breakdown as indented bullets; note/customization only when showNotes is true)
          const items = data.items || [];
          const itemsHTML = buildItemsHtmlForPrint(items, { showPrices: true, showNotes });

          // Calculate total items
          const totalItems = items.reduce((sum: number, item: any) => sum + (item.quantity || 1), 0);

          // Format date/time
          const formatDateTime = (date: Date): string => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            const seconds = String(date.getSeconds()).padStart(2, '0');
            return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
          };

          const currentDate = new Date(data.date || Date.now());
          const orderTime = formatDateTime(currentDate);
          const printTime = formatDateTime(new Date());

          // Determine transaction type display (DINE IN / TAKE AWAY)
          const pickupMethod = data.pickupMethod || 'dine-in';
          const isDineIn = pickupMethod === 'dine-in';
          const transactionDisplay = isDineIn ? 'DINE IN' : 'TAKE AWAY';

          // Calculate display counter (same logic as generateReceiptHTML)
          // For bills, use table number if available, otherwise fallback to counter
          let displayCounter: string | number;
          if (isBill && data.tableNumber) {
            // For bills, prefer table number
            displayCounter = data.tableNumber;
          } else {
            const isReceiptize = data.printerType === 'receiptizePrinter';
            const perPrinterCounter = isReceiptize ? data.printer2Counter : data.printer1Counter;
            if (typeof perPrinterCounter === 'number' && perPrinterCounter > 0) {
              displayCounter = perPrinterCounter;
            } else if (typeof data.globalCounter === 'number' && data.globalCounter > 0) {
              displayCounter = data.globalCounter;
            } else if (data.tableNumber) {
              displayCounter = data.tableNumber;
            } else {
              displayCounter = '01';
            }
          }
          const displayCounterStr = String(displayCounter).padStart(2, '0');

          // Prepare logo HTML from receipt_settings
          let logoHTML = '';
          if (receiptSettings?.logo_base64) {
            logoHTML = `<div class="logo-container"><img src="${receiptSettings.logo_base64}" class="logo" alt="Logo"></div>`;
          }

          const hasVoucher = typeof data.voucherDiscount === 'number' && data.voucherDiscount > 0;
          // Subtotal: prefer data.total; fallback to sum of items when total is missing/zero but items exist
          const itemsSum = items.reduce((sum: number, item: { total_price?: number }) => sum + (Number(item?.total_price) || 0), 0);
          const subTotal = (typeof data.total === 'number' && data.total >= 0) ? data.total : (itemsSum > 0 ? itemsSum : 0);
          const finalAmount = (typeof data.final_amount === 'number' && data.final_amount >= 0)
            ? data.final_amount
            : Math.max(0, subTotal - (typeof data.voucherDiscount === 'number' ? data.voucherDiscount : 0));
          const voucherDiscount = typeof data.voucherDiscount === 'number' ? data.voucherDiscount : 0;
          const voucherLabel = typeof data.voucherLabel === 'string' ? data.voucherLabel : '';

          // Build template data (use displayBusinessName so pengaturan konten store_name is used when set)
          const templateData: ReceiptTemplateData = {
            businessName: displayBusinessName,
            items: itemsHTML,
            total: subTotal,
            totalItems: totalItems,
            paymentMethod: data.paymentMethod || 'Cash',
            amountReceived: data.amountReceived || 0,
            change: data.change || 0,
            orderTime: orderTime,
            printTime: printTime,
            transactionDisplay: transactionDisplay,
            displayCounter: displayCounterStr,
            receiptNumber: String(data.receiptNumber ?? data.id ?? 'N/A'),
            cashier: data.cashier || 'N/A',
            customerName: data.customerName || data.customer_name || '',
            isBill: isBill,
            isReprint: data.isReprint || false,
            reprintCount: data.reprintCount,
            leftPadding: (7 - clampedMarginAdjustMm).toFixed(2),
            rightPadding: (7 + clampedMarginAdjustMm).toFixed(2),
            // Receipt settings data
            contactPhone: receiptSettings?.contact_phone || '',
            logo: logoHTML,
            address: receiptSettings?.address || '',
            footerText: receiptSettings?.footer_text || '',
            // Bill discount (optional) - finalAmount is grand total (subtotal - voucher)
            voucherDiscount,
            voucherLabel,
            finalAmount,
            hasVoucher,
          };

          // Render template
          htmlContent = receiptManagementService.renderTemplate(templateCode, templateData);
          console.log(`✅ ${templateType} template rendered successfully`);
        } else {
          console.warn(`⚠️ No ${templateType} template found, falling back to hardcoded HTML generation`);
          const fallbackOptions = { ...receiptFormattingOptions, showNotes };
          if (data.type === 'test') {
            const receiptSettings = await receiptManagementService.getReceiptSettings(data.business_id);
            htmlContent = generateTestReceiptHTML(printerName, businessName, fallbackOptions, receiptSettings ?? undefined);
          } else {
            htmlContent = generateReceiptHTML(data, businessName, fallbackOptions);
          }
        }
      } catch (templateError) {
        console.error('❌ Error using template, falling back to hardcoded HTML:', templateError);
        const fallbackOptions = { ...receiptFormattingOptions, showNotes: false };
        if (data.type === 'test') {
          const receiptSettings = await receiptManagementService.getReceiptSettings(data.business_id).catch(() => null);
          htmlContent = generateTestReceiptHTML(printerName, businessName, fallbackOptions, receiptSettings ?? undefined);
        } else {
          htmlContent = generateReceiptHTML(data, businessName, fallbackOptions);
        }
      }
    }

    await printWindow.loadURL(`data:text/html,${encodeURIComponent(htmlContent)}`);

    return new Promise((resolve) => {
      const currentWindow = printWindow;
      setTimeout(async () => {
        try {
          if (!currentWindow || currentWindow.isDestroyed()) {
            console.error('❌ Print window not available when attempting to print');
            resolve({ success: false, error: 'Print window unavailable' });
            return;
          }
          const deviceName = await resolvePrintDeviceName(currentWindow.webContents, printerName);
          if (!deviceName) {
            console.error('❌ Printer not found in system list:', printerName);
            resolve({ success: false, error: `Printer "${printerName}" tidak ditemukan. Buka Setelan → Printer dan pilih printer lagi.` });
            if (currentWindow && !currentWindow.isDestroyed()) currentWindow.close();
            if (printWindow === currentWindow) printWindow = null;
            return;
          }
          const printOptions: { silent: boolean; printBackground: boolean; deviceName?: string } = {
            silent: true,
            printBackground: false,
            ...(deviceName ? { deviceName } : {}),
          };

          let receiptRetriedOnce = false;
          const doPrint = () => {
            currentWindow.webContents.print(printOptions, (success: boolean, errorType: string) => {
              if (success) {
                console.log('✅ Print sent successfully');
                resolve({ success: true });
              } else {
                const isCanceled = /cancel|canceled/i.test(String(errorType));
                if (isCanceled && !receiptRetriedOnce && currentWindow && !currentWindow.isDestroyed()) {
                  receiptRetriedOnce = true;
                  console.warn('⚠️ Print job canceled, retrying once in 1.5s...');
                  setTimeout(doPrint, 1500);
                  return;
                }
                console.error('❌ Print failed:', errorType);
                resolve({ success: false, error: errorType });
              }
              setTimeout(() => {
                if (currentWindow && !currentWindow.isDestroyed()) {
                  currentWindow.close();
                }
                if (printWindow === currentWindow) {
                  printWindow = null;
                }
              }, 1000);
            });
          };
          doPrint();
        } catch (err) {
          console.error('❌ Exception during webContents.print:', err);
          resolve({ success: false, error: String(err) });
          if (currentWindow && !currentWindow.isDestroyed()) {
            currentWindow.close();
          }
          if (printWindow === currentWindow) {
            printWindow = null;
          }
        }
      }, 500);
    });
  } catch (error) {
    console.error('❌ Error in print-receipt handler:', error);
    return { success: false, error: String(error) };
  }
});

// Receipt Management IPC Handlers
const receiptManagementService = new ReceiptManagementService();

ipcMain.handle('get-receipt-template', async (event, templateType: 'receipt' | 'bill' | 'checker', businessId?: number) => {
  try {
    const result = await receiptManagementService.getReceiptTemplate(templateType, businessId);
    return result.templateCode;
  } catch (error) {
    console.error('Error getting receipt template:', error);
    return null;
  }
});

ipcMain.handle('get-receipt-templates', async (event, templateType: 'receipt' | 'bill' | 'checker', businessId?: number) => {
  try {
    const templates = await receiptManagementService.getReceiptTemplates(templateType, businessId);
    return { success: true, templates };
  } catch (error) {
    console.error('Error getting receipt templates:', error);
    return { success: false, error: String(error), templates: [] };
  }
});

ipcMain.handle('get-receipt-template-by-id', async (event, id: number) => {
  try {
    const result = await receiptManagementService.getReceiptTemplateById(id);
    return { success: true, templateCode: result.templateCode, showNotes: result.showNotes, oneLabelPerProduct: result.oneLabelPerProduct };
  } catch (error) {
    console.error('Error getting receipt template by id:', error);
    return { success: false, error: String(error), templateCode: null, showNotes: false, oneLabelPerProduct: true };
  }
});

ipcMain.handle('set-default-receipt-template', async (event, templateType: 'receipt' | 'bill' | 'checker', templateName: string, businessId?: number) => {
  try {
    const success = await receiptManagementService.setDefaultTemplate(templateType, templateName, businessId);
    return { success };
  } catch (error) {
    console.error('Error setting default receipt template:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('save-receipt-template', async (event, templateType: 'receipt' | 'bill' | 'checker', templateCode: string, templateName?: string, businessId?: number, showNotes?: boolean, oneLabelPerProduct?: boolean) => {
  try {
    const success = await receiptManagementService.saveReceiptTemplate(templateType, templateCode, templateName, businessId, showNotes, oneLabelPerProduct);
    return { success };
  } catch (error) {
    console.error('Error saving receipt template:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('update-receipt-template', async (event, id: number, templateCode: string, templateName?: string | null, showNotes?: boolean, oneLabelPerProduct?: boolean) => {
  try {
    if (templateName !== undefined && templateName !== null && String(templateName).trim() === '') {
      templateName = undefined;
    }
    const success = await receiptManagementService.updateReceiptTemplate(id, templateCode, templateName, showNotes, oneLabelPerProduct);
    return { success };
  } catch (error) {
    console.error('Error updating receipt template:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('upload-template-to-vps', async (event, id: number) => {
  try {
    return await receiptManagementService.uploadTemplateToVps(id);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: msg || 'Gagal upload' };
  }
});

ipcMain.handle('download-template-from-vps', async (event, id: number) => {
  try {
    return await receiptManagementService.downloadTemplateFromVps(id);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: msg || 'Gagal download' };
  }
});

ipcMain.handle('get-receipt-settings', async (event, businessId?: number) => {
  try {
    const settings = await receiptManagementService.getReceiptSettings(businessId);
    return { success: true, settings };
  } catch (error) {
    console.error('Error getting receipt settings:', error);
    return { success: false, error: String(error), settings: null };
  }
});

ipcMain.handle('save-receipt-settings', async (event, settings: {
  store_name?: string | null;
  address?: string | null;
  phone_number?: string | null;
  contact_phone?: string | null;
  logo_base64?: string | null;
  footer_text?: string | null;
  partnership_contact?: string | null;
}, businessId?: number) => {
  try {
    const success = await receiptManagementService.saveReceiptSettings(settings, businessId);
    return { success };
  } catch (error) {
    console.error('Error saving receipt settings:', error);
    return { success: false, error: String(error) };
  }
});

// Execute single label print (used by queue)
async function executeLabelPrint(data: LabelPrintData): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('🏷️ [EXECUTE] Printing label - Full data received:', JSON.stringify(data, null, 2));

    let printerName = data.printerName;
    let copies = 1;
    let labelMarginAdjustMm: number | undefined =
      typeof data.marginAdjustMm === 'number' && !Number.isNaN(data.marginAdjustMm) ? data.marginAdjustMm : undefined;

    // If printer name is not specified, try to get it from saved config
    if (!printerName || data.printerType) {
      if (data.printerType) {
        console.log('🔍 Fetching printer config for printer type:', data.printerType);

        try {
          const config = await executeQueryOne<PrinterConfigRow>('SELECT * FROM printer_configs WHERE printer_type = ?', [data.printerType]);

          if (config) {
            if (!printerName && config.system_printer_name?.trim()) {
              printerName = config.system_printer_name;
              console.log('✅ Found saved printer:', printerName);
            }
            if (config.extra_settings) {
              try {
                const extra = typeof config.extra_settings === 'string' ? JSON.parse(config.extra_settings) : config.extra_settings;
                if (extra && typeof extra.copies === 'number' && extra.copies > 0) {
                  copies = Math.min(10, Math.floor(extra.copies));
                }
                if (labelMarginAdjustMm === undefined && typeof extra.marginAdjustMm === 'number' && !Number.isNaN(extra.marginAdjustMm)) {
                  labelMarginAdjustMm = extra.marginAdjustMm;
                }
              } catch (_) { /* ignore */ }
            }
          }
          if (!printerName && !config) {
            console.log('⚠️ No saved printer config found for type:', data.printerType);
            return { success: false, error: 'Label printer not configured. Please set up a valid printer in Settings.' };
          }
          if (!printerName && config && (!config.system_printer_name || config.system_printer_name.trim() === '')) {
            console.log('⚠️ Printer config found but system_printer_name is empty:', config);
            return { success: false, error: 'Label printer not configured. Please set up a valid printer in Settings.' };
          }
        } catch (error) {
          console.error('❌ Error fetching printer config:', error);
          return { success: false, error: 'Error loading printer configuration.' };
        }
      }
    }

    if (!printerName) {
      console.error('❌ No printer name provided!');
      return { success: false, error: 'No printer specified.' };
    }

    // Create a new print window for this job (don't reuse global)
    const jobPrintWindow = new BrowserWindow({
      width: 400,
      height: 600,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      }
    });

    // Padding for 80mm checker template (same as receipt): prevents right-side cutoff (pelanggan, meja, waktu pesanan)
    const labelMarginClamped = Math.max(-5, Math.min(5, labelMarginAdjustMm ?? 0));
    const labelLeftPadding = (7 - labelMarginClamped).toFixed(2);
    const labelRightPadding = (7 + labelMarginClamped).toFixed(2);

    // Generate label HTML: use checker template if available (same template logic as receipt); showNotes controls customizations
    let htmlContent: string;
    let templateCodeForLog = '';
    try {
      const checkerResult = await receiptManagementService.getReceiptTemplate('checker', data.business_id);
      // #region agent log
      const code = checkerResult.templateCode ?? '';
      templateCodeForLog = code;
      const codeLen = code.length;
      const pageSize = code.includes('40mm') ? '40mm' : code.includes('80mm') ? '80mm' : 'other';
      const h1Payload = { location: 'main.ts:label-print', message: 'which template used (single label)', data: { businessIdRequested: data.business_id, templateName: checkerResult.templateName ?? null, templateCodeLength: codeLen, pageSize, hasTemplateCode: !!(checkerResult.templateCode && checkerResult.templateCode.trim()) }, hypothesisId: 'H1' as const };
      writeLabelDebugLog(h1Payload);
      fetch('http://127.0.0.1:7495/ingest/20000880-6f22-4a8b-8a8e-250eeb7d84f4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'76ac0a'},body:JSON.stringify({sessionId:'76ac0a',...h1Payload,timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const dataCustomizations = typeof data.customizations === 'string' ? data.customizations : '';
      const hasCustomizations = (dataCustomizations || '').trim().length > 0;
      const stripCustomizations = !checkerResult.showNotes;
      if (checkerResult.templateCode && checkerResult.templateCode.trim()) {
        const labelData: LabelPrintData = checkerResult.showNotes ? data : { ...data, customizations: '', labelContinuation: '' };
        labelData.leftPadding = labelLeftPadding;
        labelData.rightPadding = labelRightPadding;
        if (labelData.itemNumber == null || labelData.itemNumber === 0) labelData.itemNumber = 1;
        if (labelData.totalItems == null || labelData.totalItems === 0) labelData.totalItems = 1;
        htmlContent = generateLabelHTMLFromTemplate(checkerResult.templateCode.trim(), labelData);
        // #region agent log
        const h2Payload = { location: 'main.ts:label-print', message: 'used DB template path', data: { htmlContentLength: htmlContent?.length ?? 0 }, hypothesisId: 'H2' as const };
        writeLabelDebugLog(h2Payload);
        fetch('http://127.0.0.1:7495/ingest/20000880-6f22-4a8b-8a8e-250eeb7d84f4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'76ac0a'},body:JSON.stringify({sessionId:'76ac0a',...h2Payload,timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      } else {
        htmlContent = generateLabelHTML(data);
        // #region agent log
        const h4Payload = { location: 'main.ts:label-print', message: 'used fallback generateLabelHTML', data: { htmlContentLength: htmlContent?.length ?? 0 }, hypothesisId: 'H4' as const };
        writeLabelDebugLog(h4Payload);
        fetch('http://127.0.0.1:7495/ingest/20000880-6f22-4a8b-8a8e-250eeb7d84f4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'76ac0a'},body:JSON.stringify({sessionId:'76ac0a',...h4Payload,timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      }
    } catch (e) {
      console.warn('⚠️ Checker template load failed, using built-in label HTML:', e);
      htmlContent = generateLabelHTML(data);
      // #region agent log
      const h4ErrPayload = { location: 'main.ts:label-print', message: 'checker load failed, fallback', data: { error: String(e), htmlContentLength: htmlContent?.length ?? 0 }, hypothesisId: 'H4' as const };
      writeLabelDebugLog(h4ErrPayload);
      fetch('http://127.0.0.1:7495/ingest/20000880-6f22-4a8b-8a8e-250eeb7d84f4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'76ac0a'},body:JSON.stringify({sessionId:'76ac0a',...h4ErrPayload,timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    }

    // #region agent log – label height: @page in template vs final HTML (debug-ba378a)
    const atPageInTemplate = getAtPageSnippet(templateCodeForLog);
    const atPageInFinal = getAtPageSnippet(htmlContent);
    const pagePayload = { sessionId: 'ba378a', location: 'main.ts:label-print', message: 'label @page (single)', data: { atPageInTemplate, atPageInFinal, has30mmInTemplate: templateCodeForLog.includes('30mm'), hasAutoInTemplate: templateCodeForLog.includes('auto') }, hypothesisId: 'H-page', timestamp: Date.now() };
    console.log('[LABEL HEIGHT DEBUG] single label @page in template:', atPageInTemplate, '| in final HTML:', atPageInFinal);
    fetch('http://127.0.0.1:7495/ingest/20000880-6f22-4a8b-8a8e-250eeb7d84f4', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ba378a' }, body: JSON.stringify(pagePayload) }).catch(() => {});
    // #endregion

    await jobPrintWindow.loadURL(`data:text/html,${encodeURIComponent(htmlContent)}`);

    return new Promise((resolve) => {
      setTimeout(async () => {
        try {
          if (!jobPrintWindow || jobPrintWindow.isDestroyed()) {
            console.error('❌ Print window not available when attempting to print label');
            resolve({ success: false, error: 'Print window unavailable' });
            return;
          }
          const deviceName = await resolvePrintDeviceName(jobPrintWindow.webContents, printerName);
          const is40x30Label = htmlContent.includes('40mm') && htmlContent.includes('30mm');
          const printOptions: { silent: boolean; printBackground: boolean; deviceName?: string; pageSize?: { width: number; height: number } } = {
            silent: true,
            printBackground: false,
            ...(deviceName ? { deviceName } : {}),
            ...(is40x30Label ? { pageSize: { width: 40000, height: 30000 } } : {}),
          };
          const numCopies = Math.max(1, Math.min(10, copies));
          let printedCount = 0;
          const doOnePrint = () => {
            jobPrintWindow.webContents.print(printOptions, (success: boolean, errorType: string) => {
              if (!success) {
                console.error('❌ Label print failed:', errorType);
                resolve({ success: false, error: errorType });
                setTimeout(() => {
                  if (jobPrintWindow && !jobPrintWindow.isDestroyed()) jobPrintWindow.close();
                }, 500);
                return;
              }
              printedCount += 1;
              if (printedCount >= numCopies) {
                console.log('✅ Label sent successfully' + (numCopies > 1 ? ` (${numCopies} copies)` : ''));
                resolve({ success: true });
                setTimeout(() => {
                  if (jobPrintWindow && !jobPrintWindow.isDestroyed()) jobPrintWindow.close();
                }, 500);
                return;
              }
              setTimeout(doOnePrint, 400);
            });
          };
          doOnePrint();
        } catch (err) {
          console.error('❌ Exception during webContents.print:', err);
          resolve({ success: false, error: String(err) });
          if (jobPrintWindow && !jobPrintWindow.isDestroyed()) {
            jobPrintWindow.close();
          }
        }
      }, 500);
    });
  } catch (error) {
    console.error('❌ Error in executeLabelPrint:', error);
    return { success: false, error: String(error) };
  }
}

// Execute batch labels print (used by queue)
/** Order context for checker template "order summary" slip (waiter, customer, table, items table). */
type OrderContextForChecker = {
  waiterName?: string;
  customerName?: string;
  tableName?: string;
  orderTime?: string;
  itemsHtml?: string;
  itemsHtmlCategory1?: string;
  itemsHtmlCategory2?: string;
  category1Name?: string;
  category2Name?: string;
  /** All Category 1 sections (for template placeholder {{categoriesSections}}). */
  categories?: Array<{ categoryName: string; itemsHtml: string }>;
};

/** Minimal template used when checker template has no {{items}} but we have orderContext (print one slip with notes). */
const FALLBACK_ORDER_SUMMARY_CHECKER_TEMPLATE = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>@page{size:80mm auto;margin:0;}*{margin:0;padding:0;box-sizing:border-box;}body{font-family:Arial,sans-serif;width:42ch;font-size:9pt;padding:2mm 7mm;}table{width:100%;border-collapse:collapse;}td,th{padding:0.5mm 0;}tr.package-subitem td{font-size:8pt;padding-left:3mm;}</style></head><body>
<div style="font-weight:700;margin-bottom:1mm;">Pelanggan: {{customerName}}</div>
<div style="font-weight:700;margin-bottom:1mm;">Meja: {{tableName}}</div>
<div style="font-size:8pt;margin-bottom:2mm;">{{orderTime}}</div>
<table><tr><th style="text-align:left;">Item</th><th style="text-align:right;">Harga</th><th style="text-align:right;">Jml</th><th style="text-align:right;">Subtotal</th></tr>{{items}}</table>
</body></html>`;

async function executeLabelsBatchPrint(data: {
  labels: LabelPrintData[];
  printerName?: string;
  printerType?: string;
  business_id?: number;
  orderContext?: OrderContextForChecker;
  /** When true, use nonOfflineCopies for labelPrinter (GoFood, Grab, Shopee, Qpon, TikTok) */
  isOnlineOrder?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const businessId = data.business_id ?? data.labels?.[0]?.business_id;
    const hasOrderContext = data.orderContext && (
      data.orderContext.waiterName != null ||
      data.orderContext.customerName != null ||
      data.orderContext.tableName != null ||
      data.orderContext.orderTime != null ||
      (data.orderContext.itemsHtml != null && data.orderContext.itemsHtml !== '') ||
      (data.orderContext.itemsHtmlCategory1 != null && data.orderContext.itemsHtmlCategory1 !== '') ||
      (data.orderContext.itemsHtmlCategory2 != null && data.orderContext.itemsHtmlCategory2 !== '') ||
      (Array.isArray(data.orderContext.categories) && data.orderContext.categories.length > 0)
    );

    // Load checker template early to decide order-summary vs per-item mode
    let checkerResult: { templateCode: string | null; showNotes: boolean; templateName?: string | null; oneLabelPerProduct?: boolean } = { templateCode: null, showNotes: false, oneLabelPerProduct: true };
    try {
      checkerResult = await receiptManagementService.getReceiptTemplate('checker', businessId ?? undefined);
    } catch (_) {
      // ignore
    }
    const firstLabelCustomizations = data.labels?.[0] && typeof (data.labels[0] as { customizations?: string }).customizations === 'string' ? (data.labels[0] as { customizations: string }).customizations : '';
    // #region agent log – which template is used (for debug-76ac0a.log)
    const requestId = (data as any).requestId || 'NO-ID';
    const code = checkerResult.templateCode ?? '';
    const pageSize = code.includes('40mm') ? '40mm' : code.includes('80mm') ? '80mm' : 'other';
    const batchPayload = { location: 'main.ts:batch-label-print', message: 'which template used (batch)', data: { requestId, businessIdUsed: businessId ?? null, templateName: checkerResult.templateName ?? null, templateCodeLength: code.length, pageSize, hasCheckerTemplate: !!checkerResult.templateCode?.trim() }, hypothesisId: 'which' as const };
    writeLabelDebugLog(batchPayload);
    console.error(`🖨️ [BACKEND] Received printLabelsBatch. ID: ${requestId}. Table: ${data.orderContext?.tableName}. Time: ${data.orderContext?.orderTime}. Template: ${checkerResult.templateName ?? '(fallback)'} (${pageSize})`);
    fetch('http://127.0.0.1:7245/ingest/519de021-d49d-473f-a8a1-4215977c867a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'main.ts:executeLabelsBatchPrint', message: 'batch label checker result', data: { requestId, businessId: businessId ?? null, templateName: checkerResult.templateName, checkerShowNotes: checkerResult.showNotes, hasCheckerTemplate: !!checkerResult.templateCode?.trim(), pageSize, firstLabelCustomizationsLength: (firstLabelCustomizations || '').length }, timestamp: Date.now(), hypothesisId: 'A' }) }).catch(() => { });
    // #endregion
    const checkerTemplateCode = checkerResult.templateCode?.trim() ?? null;
    const templateUsesItems = checkerTemplateCode != null && (checkerTemplateCode.includes('{{items}}') || checkerTemplateCode.includes('{{itemsCategory1}}') || checkerTemplateCode.includes('{{itemsCategory2}}') || checkerTemplateCode.includes('{{categoriesSections}}'));
    const hasOrderContextWithItems = hasOrderContext && (data.orderContext?.itemsHtml != null && String(data.orderContext.itemsHtml).trim() !== '');
    const oneLabelPerProduct = checkerResult.oneLabelPerProduct !== false;
    // Use order-summary slip when template setting "1 label per product" is unchecked (oneLabelPerProduct === false) and we have order context. When checked, use per-item labels. If template has {{items}}, use it for the slip; otherwise use fallback slip template.
    const useOrderSummarySlip = hasOrderContextWithItems && !oneLabelPerProduct;
    const slipTemplateCode = templateUsesItems && checkerTemplateCode
      ? checkerTemplateCode
      : hasOrderContextWithItems
        ? FALLBACK_ORDER_SUMMARY_CHECKER_TEMPLATE
        : null;

    if (!useOrderSummarySlip && (!data.labels || !Array.isArray(data.labels) || data.labels.length === 0)) {
      console.error('❌ No labels provided for batch printing');
      return { success: false, error: 'No labels provided for batch printing.' };
    }

    const effectiveLabelOrSlipCount = useOrderSummarySlip ? 1 : (data.labels?.length || 0);
    // #region agent log
    fetch('http://127.0.0.1:7245/ingest/519de021-d49d-473f-a8a1-4215977c867a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'main.ts:executeLabelsBatchPrint', message: 'batch print effective count', data: { useOrderSummarySlip, effectiveLabelOrSlipCount, labelsLength: data.labels?.length ?? 0 }, timestamp: Date.now(), hypothesisId: 'count' }) }).catch(() => { });
    // #endregion
    console.log('🏷️ [EXECUTE] Printing labels batch - Count:', effectiveLabelOrSlipCount, useOrderSummarySlip ? '(order summary slip)' : '');
    let printerName = data.printerName;
    let copies = 1;
    const dataMargin = (data as unknown as { marginAdjustMm?: number }).marginAdjustMm;
    let batchMarginAdjustMm: number | undefined =
      typeof dataMargin === 'number' && !Number.isNaN(dataMargin) ? dataMargin : undefined;

    // Resolve printer name and copies from config when printerType is set
    if (!printerName || data.printerType) {
      if (data.printerType) {
        try {
          const config = await executeQueryOne<PrinterConfigRow>('SELECT * FROM printer_configs WHERE printer_type = ?', [data.printerType]);
          if (config) {
            if (!printerName && config.system_printer_name?.trim()) {
              printerName = config.system_printer_name;
              console.log('✅ Found saved printer:', printerName);
            }
            if (config.extra_settings) {
              try {
                const extra = typeof config.extra_settings === 'string' ? JSON.parse(config.extra_settings) : config.extra_settings;
                // Label printer (Printer 3): use copies for offline, nonOfflineCopies for GoFood/Grab/Shopee/Qpon/TikTok
                if (data.printerType === 'labelPrinter' && data.isOnlineOrder === true && extra && typeof extra.nonOfflineCopies === 'number' && extra.nonOfflineCopies > 0) {
                  copies = Math.min(10, Math.floor(extra.nonOfflineCopies));
                } else if (extra && typeof extra.copies === 'number' && extra.copies > 0) {
                  copies = Math.min(10, Math.floor(extra.copies));
                }
                if (batchMarginAdjustMm === undefined && typeof extra.marginAdjustMm === 'number' && !Number.isNaN(extra.marginAdjustMm)) {
                  batchMarginAdjustMm = extra.marginAdjustMm;
                }
              } catch (_) { /* ignore */ }
            }
          }
          if (!printerName && !config) {
            return { success: false, error: 'Label printer not configured. Please set up a valid printer in Settings.' };
          }
          if (!printerName && config && (!config.system_printer_name || config.system_printer_name.trim() === '')) {
            return { success: false, error: 'Label printer not configured. Please set up a valid printer in Settings.' };
          }
        } catch (error) {
          console.error('❌ Error fetching printer config:', error);
          return { success: false, error: 'Error loading printer configuration.' };
        }
      }
    }
    if (!printerName) {
      console.error('❌ No printer name provided!');
      return { success: false, error: 'No printer specified.' };
    }

    // Create a new print window for this job (don't reuse global)
    const jobPrintWindow = new BrowserWindow({
      width: 400,
      height: 600,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      }
    });

    // Padding for 80mm checker template (same as receipt): prevents right-side cutoff (pelanggan, meja, waktu pesanan)
    const batchMarginClamped = Math.max(-5, Math.min(5, batchMarginAdjustMm ?? 0));
    const batchLeftPadding = (7 - batchMarginClamped).toFixed(2);
    const batchRightPadding = (7 + batchMarginClamped).toFixed(2);

    // Generate batch label HTML: use checker template if available; showNotes controls customizations per label
    let htmlContent: string;
    try {
      // --- 1st checker: build order-summary slip HTML (one slip per order when template uses {{items}}) ---
      if (useOrderSummarySlip && slipTemplateCode && data.orderContext) {
        const orderData: LabelPrintData = {
          waiterName: data.orderContext.waiterName ?? '',
          customerName: data.orderContext.customerName ?? '',
          tableName: data.orderContext.tableName ?? '',
          orderTime: data.orderContext.orderTime ?? new Date().toISOString(),
          items: data.orderContext.itemsHtml ?? '',
          itemsCategory1: data.orderContext.itemsHtmlCategory1 ?? '',
          itemsCategory2: data.orderContext.itemsHtmlCategory2 ?? '',
          category1Name: data.orderContext.category1Name ?? '',
          category2Name: data.orderContext.category2Name ?? '',
          categories: data.orderContext.categories,
          leftPadding: batchLeftPadding,
          rightPadding: batchRightPadding,
        };
        htmlContent = generateLabelHTMLFromTemplate(slipTemplateCode, orderData); // 1st checker HTML ready
        // #region agent log — debug what is printed on 1st print (content; printer name logged later when we resolve it)
        fetch('http://127.0.0.1:7245/ingest/519de021-d49d-473f-a8a1-4215977c867a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'main.ts:executeLabelsBatchPrint:1stPrintContent', message: '1st print content (order summary slip)', data: { firstPrintPath: true, orderDataSummary: { waiterName: orderData.waiterName, customerName: orderData.customerName, tableName: orderData.tableName, orderTime: orderData.orderTime, itemsHtmlLength: (orderData.items || '').length, itemsHtmlPreview: (orderData.items || '').substring(0, 500) }, htmlContentLength: htmlContent.length, htmlContentPreview: htmlContent.substring(0, 2500) }, timestamp: Date.now(), hypothesisId: '1stPrint' }) }).catch(() => { });
        // #endregion
      } else {
        // Normalize itemNumber (1-based) and totalItems so counter shows e.g. 1/6, 2/6, ... on each label
        const labelsCount = data.labels?.length ?? 0;
        const labelsToPrint = (data.labels ?? []).map((label, index) => {
          const L = label as Record<string, unknown>;
          const itemNum = (typeof L.itemNumber === 'number' && !Number.isNaN(L.itemNumber) && L.itemNumber > 0) ? L.itemNumber : index + 1;
          const total = (typeof L.totalItems === 'number' && !Number.isNaN(L.totalItems) && L.totalItems > 0) ? L.totalItems : labelsCount;
          return { ...label, itemNumber: itemNum, totalItems: total };
        });
        if (checkerTemplateCode) {
          const fullHtmls = labelsToPrint.map((label) => {
            const base = checkerResult.showNotes ? label : { ...label, customizations: '', labelContinuation: '' };
            // Ensure waiter/meja and orderTime show on each per-item label when orderContext is provided (Kasir checker)
            const labelData: LabelPrintData = data.orderContext
              ? { ...base, waiterName: data.orderContext.waiterName ?? base.waiterName ?? '', tableName: data.orderContext.tableName ?? base.tableName ?? '', customerName: data.orderContext.customerName ?? base.customerName ?? '', orderTime: data.orderContext.orderTime ?? base.orderTime }
              : base;
            labelData.leftPadding = batchLeftPadding;
            labelData.rightPadding = batchRightPadding;
            return generateLabelHTMLFromTemplate(checkerTemplateCode, labelData);
          });
          htmlContent = mergeLabelHtmlsIntoOne(fullHtmls);
        } else {
          htmlContent = generateMultipleLabelsHTML(labelsToPrint);
        }
        // #region agent log — debug what is printed when NOT order-summary slip (per-item or merged labels)
        const firstL = data.labels?.[0];
        fetch('http://127.0.0.1:7245/ingest/519de021-d49d-473f-a8a1-4215977c867a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'main.ts:executeLabelsBatchPrint:1stPrintContent', message: '1st print content (per-item/merged labels path)', data: { firstPrintPath: false, labelsCount: data.labels?.length, firstLabel: firstL ? { productName: (firstL as { productName?: string }).productName, pickupMethod: (firstL as { pickupMethod?: string }).pickupMethod } : undefined, htmlContentLength: htmlContent?.length, htmlContentPreview: (htmlContent || '').substring(0, 2500) }, timestamp: Date.now(), hypothesisId: '1stPrint' }) }).catch(() => { });
        // #endregion
      }
    } catch (e) {
      console.warn('⚠️ Checker template load failed, using built-in batch label HTML:', e);
      htmlContent = useOrderSummarySlip ? '' : generateMultipleLabelsHTML(data.labels);
      if (!htmlContent && useOrderSummarySlip) {
        return { success: false, error: 'Failed to generate order summary slip.' };
      }
    }

    // #region agent log – label height: @page in batch (debug-ba378a)
    const batchTemplateCode = checkerTemplateCode ?? '';
    const atPageBatchTemplate = getAtPageSnippet(batchTemplateCode);
    const atPageBatchFinal = getAtPageSnippet(htmlContent);
    const batchPagePayload = { sessionId: 'ba378a', location: 'main.ts:executeLabelsBatchPrint', message: 'label @page (batch)', data: { atPageInTemplate: atPageBatchTemplate, atPageInFinal: atPageBatchFinal, has30mmInTemplate: batchTemplateCode.includes('30mm'), hasAutoInTemplate: batchTemplateCode.includes('auto'), useOrderSummarySlip }, hypothesisId: 'H-page', timestamp: Date.now() };
    console.log('[LABEL HEIGHT DEBUG] batch @page in template:', atPageBatchTemplate, '| in final HTML:', atPageBatchFinal);
    fetch('http://127.0.0.1:7495/ingest/20000880-6f22-4a8b-8a8e-250eeb7d84f4', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ba378a' }, body: JSON.stringify(batchPagePayload) }).catch(() => {});
    // #endregion

    // --- 1st checker: load generated HTML into print window ---
    console.log(`📝 [BACKEND] Generated HTML for ID ${requestId} (first 100 chars): ${htmlContent.substring(0, 100)}...`);
    await jobPrintWindow.loadURL(`data:text/html,${encodeURIComponent(htmlContent)}`);

    return new Promise((resolve) => {
      setTimeout(async () => {
        try {
          if (!jobPrintWindow || jobPrintWindow.isDestroyed()) {
            console.error('❌ Print window not available when attempting to print labels batch');
            resolve({ success: false, error: 'Print window unavailable' });
            return;
          }
          const deviceName = await resolvePrintDeviceName(jobPrintWindow.webContents, printerName);
          const is40x30LabelBatch = htmlContent.includes('40mm') && htmlContent.includes('30mm');
          const printOptions: { silent: boolean; printBackground: boolean; deviceName?: string; pageSize?: { width: number; height: number } } = {
            silent: true,
            printBackground: false,
            ...(deviceName ? { deviceName } : {}),
            ...(is40x30LabelBatch ? { pageSize: { width: 40000, height: 30000 } } : {}),
          };

          // Many label/thermal printers ignore the 'copies' option; print N times to get N physical copies
          const numCopies = Math.max(1, Math.min(10, copies));
          // #region agent log — how many printed, what is printed, which printer
          const whatIsPrinted = useOrderSummarySlip ? '1 order summary slip (checker)' : `${data.labels?.length ?? 0} label(s)`;
          const contentHint = useOrderSummarySlip && data.orderContext ? { table: data.orderContext.tableName || '', itemsHtmlLength: (data.orderContext.itemsHtml || '').length } : { labelsCount: data.labels?.length ?? 0 };
          fetch('http://127.0.0.1:7245/ingest/519de021-d49d-473f-a8a1-4215977c867a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'main.ts:executeLabelsBatchPrint:printSummary', message: 'Print summary: how many and what', data: { totalPhysicalPrints: numCopies, whatIsPrinted, contentHint, printer: printerName || '(default)', deviceName: deviceName || null }, timestamp: Date.now(), hypothesisId: 'count' }) }).catch(() => { });
          // #endregion
          let printedCount = 0;
          let retriedOnce = false;
          const doOnePrint = () => {
            // --- 1st print (and subsequent copies): send checker slip to printer ---
            jobPrintWindow.webContents.print(printOptions, (success: boolean, errorType: string) => {
              if (!success) {
                const isCanceled = /cancel|canceled/i.test(String(errorType));
                if (isCanceled && !retriedOnce && jobPrintWindow && !jobPrintWindow.isDestroyed()) {
                  retriedOnce = true;
                  console.warn('⚠️ Print job canceled, retrying once in 1.5s...');
                  setTimeout(doOnePrint, 1500);
                  return;
                }
                console.error('❌ Batch labels print failed:', errorType);
                resolve({ success: false, error: errorType });
                setTimeout(() => {
                  if (jobPrintWindow && !jobPrintWindow.isDestroyed()) jobPrintWindow.close();
                }, 500);
                return;
              }
              printedCount += 1;
              if (printedCount >= numCopies) {
                console.log(`✅ Batch labels (${data.labels.length} labels) sent successfully` + (numCopies > 1 ? ` (${numCopies} copies)` : ''));
                resolve({ success: true });
                setTimeout(() => {
                  if (jobPrintWindow && !jobPrintWindow.isDestroyed()) jobPrintWindow.close();
                }, 500);
                return;
              }
              setTimeout(doOnePrint, 400);
            });
          };
          doOnePrint(); // --- 1st print: trigger first checker slip (then repeats for numCopies) ---
        } catch (err) {
          console.error('❌ Exception during webContents.print:', err);
          resolve({ success: false, error: String(err) });
          if (jobPrintWindow && !jobPrintWindow.isDestroyed()) {
            jobPrintWindow.close();
          }
        }
      }, 500);
    });
  } catch (error) {
    console.error('❌ Error in executeLabelsBatchPrint:', error);
    return { success: false, error: String(error) };
  }
}

// IPC handler for printing labels (queued)
ipcMain.handle('print-label', async (event, data: LabelPrintData) => {
  // #region agent log
  fetch('http://127.0.0.1:7245/ingest/519de021-d49d-473f-a8a1-4215977c867a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'main.ts:print-label', message: 'print operation', data: { operation: 'print-label' }, timestamp: Date.now(), hypothesisId: 'count' }) }).catch(() => { });
  // #endregion
  return new Promise((resolve, reject) => {
    console.log('📋 [PRINT QUEUE] Adding label print job to queue');
    printQueue.push({
      type: 'label',
      data,
      resolve,
      reject
    });
    // Start processing queue if not already processing
    processPrintQueue().catch(err => {
      console.error('❌ [PRINT QUEUE] Error processing queue:', err);
    });
  });
});

// IPC handler for batch printing labels (queued)
ipcMain.handle('print-labels-batch', async (event, data: {
  labels: LabelPrintData[];
  printerName?: string;
  printerType?: string;
  business_id?: number;
  orderContext?: OrderContextForChecker;
  isOnlineOrder?: boolean;
}) => {
  // When orderContext is provided and checker template uses {{items}} or {{itemsCategory1}}/{{itemsCategory2}}, we print one order-summary slip (labels can be empty)
  const hasOrderContext = data.orderContext && (
    data.orderContext.waiterName != null ||
    data.orderContext.customerName != null ||
    data.orderContext.tableName != null ||
    data.orderContext.orderTime != null ||
    (data.orderContext.itemsHtml != null && data.orderContext.itemsHtml !== '') ||
    (data.orderContext.itemsHtmlCategory1 != null && data.orderContext.itemsHtmlCategory1 !== '') ||
    (data.orderContext.itemsHtmlCategory2 != null && data.orderContext.itemsHtmlCategory2 !== '')
  );
  if (!hasOrderContext && (!data.labels || !Array.isArray(data.labels) || data.labels.length === 0)) {
    console.error('❌ No labels provided for batch printing');
    return { success: false, error: 'No labels provided for batch printing.' };
  }

  // #region agent log
  fetch('http://127.0.0.1:7245/ingest/519de021-d49d-473f-a8a1-4215977c867a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'main.ts:print-labels-batch', message: 'print operation', data: { operation: 'print-labels-batch', labelsCount: data.labels?.length ?? 0, hasOrderContext }, timestamp: Date.now(), hypothesisId: 'count' }) }).catch(() => { });
  // #endregion
  return new Promise((resolve, reject) => {
    console.log('📋 [PRINT QUEUE] Adding labels batch print job to queue');
    printQueue.push({
      type: 'labels-batch',
      data,
      resolve,
      reject
    });
    // Start processing queue if not already processing
    processPrintQueue().catch(err => {
      console.error('❌ [PRINT QUEUE] Error processing queue:', err);
    });
  });
});

// Get logo as base64 for embedding in receipt
function getLogoBase64(): string {
  try {
    // Try multiple possible paths
    const possiblePaths = [
      path.join(__dirname, '../public/logo/Momoyo.png'),
      path.join(__dirname, '../public/images/Momoyo.png'),
      path.join(__dirname, '../../public/logo/Momoyo.png'),
      path.join(__dirname, '../../public/images/Momoyo.png'),
    ];

    console.log('🔍 Looking for logo in paths:', possiblePaths);

    for (const logoPath of possiblePaths) {
      if (fs.existsSync(logoPath)) {
        console.log('✅ Found logo at:', logoPath);
        const imageBuffer = fs.readFileSync(logoPath);
        const base64Image = imageBuffer.toString('base64');
        return `data:image/png;base64,${base64Image}`;
      }
    }

    console.warn('⚠️ Logo not found in any of the checked paths');
    return '';
  } catch (error) {
    console.error('❌ Error loading logo:', error);
    return '';
  }
}

interface ReceiptFormattingOptions {
  marginAdjustMm?: number;
  showNotes?: boolean;
}

type TestReceiptSettings = { store_name?: string | null; address?: string | null; contact_phone?: string | null; logo_base64?: string | null; footer_text?: string | null } | null | undefined;

// Generate test receipt HTML with character-based formatting (optionally using saved pengaturan konten)
function generateTestReceiptHTML(printerName: string, businessName: string, options?: ReceiptFormattingOptions, receiptSettings?: TestReceiptSettings): string {
  const marginAdjust = options?.marginAdjustMm ?? 0;
  const baseLeftPadding = 7;
  const baseRightPadding = 7;
  const leftPadding = Math.max(0, baseLeftPadding - marginAdjust);
  const rightPadding = Math.max(0, baseRightPadding + marginAdjust);

  // Format date as YYYY-MM-DD HH:MM:SS
  const formatDateTime = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  // Use saved pengaturan konten when provided, else defaults
  const displayName = (receiptSettings?.store_name?.trim() || businessName).trim() || businessName;
  const logoDataUri = receiptSettings?.logo_base64?.trim() || getLogoBase64();
  const addressHtml = (receiptSettings?.address?.trim() || 'Jl. Kalimantan no. 21, Kartoharjo<br>Kec. Kartoharjo, Kota Madiun').replace(/\n/g, '<br>');
  const contactLine = receiptSettings?.contact_phone?.trim() ? `silahkan hubungi: ${receiptSettings.contact_phone.trim()}` : 'silahkan hubungi: 0813-9888-8568';
  const footerHtml = receiptSettings?.footer_text?.trim() ? receiptSettings.footer_text.trim().replace(/\n/g, '<br>') : 'Pendapat Anda sangat penting bagi kami.<br>Untuk kritik dan saran silahkan hubungi :<br>0812-1822-2666<br>Untuk layanan kemitraan dan partnership';

  const orderTime = formatDateTime(new Date());
  const printTime = formatDateTime(new Date());

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      width: 42ch;
      max-width: 42ch;
      font-size: 10pt;
      font-weight: 500;
      line-height: 1.2;
      padding: 2mm ${rightPadding.toFixed(2)}mm 2mm ${leftPadding.toFixed(2)}mm;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .contact { text-align: center; font-size: 8pt; font-weight: 600; margin-bottom: 1mm; }
    .logo-container { text-align: center; margin-bottom: 1mm; }
    .logo { max-width: 100%; height: auto; max-height: 18mm; }
    .store-name { text-align: center; font-size: 13pt; font-weight: bold; margin-bottom: 1mm; }
    .branch { text-align: center; font-size: 11pt; font-weight: 600; margin-bottom: 1mm; }
    .address { text-align: center; font-size: 8pt; font-weight: 500; margin-bottom: 1.5mm; max-width: 100%; line-height: 1.3; }
    .transaction-type { text-align: center; font-size: 10pt; font-weight: 700; margin-bottom: 1.5mm; }
    .dashed-line { border-top: 1px dashed #000; margin: 1.5mm 0; }
    .info-line { display: flex; justify-content: space-between; margin-bottom: 0.5mm; }
    .info-label { font-size: 9pt; font-weight: 500; }
    .info-value { font-size: 9pt; font-weight: 700; }
    .mono-value {
      font-family: 'Consolas', 'Lucida Console', 'Courier New', monospace;
      white-space: pre;
      font-variant-numeric: tabular-nums;
      -webkit-font-variant-numeric: tabular-nums;
      font-feature-settings: 'tnum' 1, 'lnum' 1;
    }
    .order-number-value { font-size: 9pt; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin: 1mm 0; font-size: 9pt; }
    th { text-align: left; font-weight: 700; border-bottom: 1px solid #000; padding: 0.5mm 0; font-size: 8pt; }
    td { padding: 0.5mm 0; font-weight: 500; }
    .summary-line { display: flex; justify-content: space-between; margin-bottom: 0.5mm; font-size: 9pt; font-weight: 500; }
    .summary-label { font-weight: 500; }
    .summary-value { font-weight: 700; }
    .footer { margin-top: 2mm; font-size: 8pt; text-align: center; line-height: 1.3; font-weight: 500; }
  </style>
</head>
<body>
  ${logoDataUri ? `<div class="logo-container"><img src="${logoDataUri}" class="logo" alt="Logo"></div>` : '<div class="store-name">' + (displayName || 'MOMOYO') + '</div>'}
  <div class="branch">${displayName}</div>
  <div class="address">${addressHtml}</div>
  <div class="contact">${contactLine}</div>
  
  <div class="transaction-type">DINE IN TEST PRINT</div>
  
  <div class="dashed-line"></div>
  
  <div class="info-line">
    <span class="info-label">Nomor Pesanan:</span>
    <span class="info-value order-number-value mono-value">0000000000000000000</span>
  </div>
  <div class="info-line">
    <span class="info-label">Waktu Pesanan:</span>
    <span class="info-value mono-value">${orderTime}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Waktu Print:</span>
    <span class="info-value mono-value">${printTime}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Operator Kasir:</span>
    <span class="info-value">test print</span>
  </div>
  <div class="info-line">
    <span class="info-label">Nama Pelanggan:</span>
    <span class="info-value">-</span>
  </div>
  
  <div class="dashed-line"></div>
  
  <table>
    <tr>
      <th style="width: 30%;">Nama Produk</th>
      <th style="width: 25%; text-align: right;">Harga</th>
      <th style="width: 20%; text-align: right;">Jumlah</th>
      <th style="width: 25%; text-align: right;">Subtotal</th>
    </tr>
    <tr>
      <td colspan="4" style="text-align: left; padding-bottom: 0.5mm;">testprint</td>
    </tr>
    <tr>
      <td style="width: 30%;"></td>
      <td style="width: 25%; text-align: right; padding-top: 0;">10.000</td>
      <td style="width: 20%; text-align: right; padding-top: 0;">1</td>
      <td style="width: 25%; text-align: right; padding-top: 0;">10.000</td>
    </tr>
  </table>
  
  <div class="dashed-line"></div>
  
  <div class="summary-line">
    <span class="summary-label">Total Pesanan:</span>
    <span class="summary-value">1</span>
  </div>
  <div class="summary-line">
    <span class="summary-label">Total Harga:</span>
    <span class="summary-value">10.000</span>
  </div>
  
  <div class="dashed-line"></div>
  
  <div class="summary-line">
    <span class="summary-label">Metode Pembayaran:</span>
    <span class="summary-value">Cash</span>
  </div>
  <div class="summary-line">
    <span class="summary-label">Bayar Jumlah:</span>
    <span class="summary-value">30.000</span>
  </div>
  <div class="summary-line">
    <span class="summary-label">Kembali Uang Kecil:</span>
    <span class="summary-value">20.000</span>
  </div>
  <div class="summary-line">
    <span class="summary-label">Pembayaran Sebenarnya:</span>
    <span class="summary-value">10.000</span>
  </div>
  
  <div class="dashed-line"></div>
  
  <div class="footer">
    <p>${footerHtml.split('<br>').join('</p><p>')}</p>
  </div>
</body>
</html>
  `;
}

// Generate test label HTML for 40x30mm label printer
function generateTestLabelHTML(printerName: string): string {
  const labelPrinterName = printerName || 'Label Printer';
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: 40mm 30mm; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; color: black; }
    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      width: 21ch;
      max-width: 21ch;
      font-size: 10pt;
      font-weight: 600;
      line-height: 1.4;
      padding: 3mm;
      word-wrap: break-word;
      overflow-wrap: break-word;
      color: black;
    }
    .label-content {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
      padding: 2mm 0;
    }
    .customer-name {
      font-size: 14pt;
      font-weight: 700;
      margin-bottom: 2mm;
      text-transform: uppercase;
    }
    .item-name {
      font-size: 11pt;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="label-content">
    <div class="customer-name">Austin</div>
    <div class="item-name">Matcha Latte Hot</div>
    <div style="font-size: 7pt; margin-top: 2mm;">Testing printer: ${labelPrinterName}</div>
  </div>
</body>
</html>
  `;
}

/** Escape text for safe use inside label HTML (productName, customizations). */
function escapeLabelText(s: string): string {
  if (typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generate label HTML from checker template (same template logic as receipt).
 * Placeholders:
 *   Per-item: {{counter}}, {{itemNumber}}, {{totalItems}}, {{pickupMethod}}, {{productName}}, {{customizations}}, {{orderTime}}, {{labelContinuation}}
 *   Order-summary: {{waiterName}}, {{customerName}}, {{tableName}}, {{orderTime}}, {{items}}
 */
function generateLabelHTMLFromTemplate(templateCode: string, data: LabelPrintData): string {
  const formatDateTime = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };
  const counter = data.counter ?? 0;
  const itemNumber = data.itemNumber ?? 0;
  const totalItems = data.totalItems ?? 0;
  const pickupRaw = (data.pickupMethod || 'dine-in').toString().toLowerCase().trim();
  const pickupLabel = (pickupRaw === 'take-away' || pickupRaw === 'take away' || pickupRaw.includes('take')) ? 'TAKE AWAY' : 'DINE IN';
  const productName = escapeLabelText(data.productName || '');
  const customizations = escapeLabelText(data.customizations || '');
  // Use transaction created_at when provided (from orderContext/label), else current time
  const orderTime = data.orderTime ? formatDateTime(new Date(data.orderTime)) : formatDateTime(new Date());
  const labelContinuation = escapeLabelText(data.labelContinuation || '');
  const waiterName = escapeLabelText(data.waiterName || '');
  const customerName = escapeLabelText(data.customerName || '');
  const tableName = escapeLabelText(data.tableName || '');
  const itemsHtml = typeof data.items === 'string' ? data.items : '';
  const itemsHtmlCategory1 = typeof data.itemsCategory1 === 'string' ? data.itemsCategory1 : '';
  const itemsHtmlCategory2 = typeof data.itemsCategory2 === 'string' ? data.itemsCategory2 : '';
  const category1Name = escapeLabelText(data.category1Name || 'Kategori 1');
  const category2NameRaw = (data.category2Name || '').trim();
  const category2Name = escapeLabelText(category2NameRaw || '');
  const leftPadding = data.leftPadding ?? '7.00';
  const rightPadding = data.rightPadding ?? '7.00';
  // Only show second section when there are items AND a real category1 name (e.g. Minuman); never show "Kategori 2"
  const hasItemsCategory2 =
    (itemsHtmlCategory2 || '').trim().length > 0 &&
    category2NameRaw !== '' &&
    category2NameRaw.toLowerCase() !== 'kategori 2';
  let out = templateCode;
  if (!hasItemsCategory2) {
    out = out.replace(/\{\{#ifItemsCategory2\}\}[\s\S]*?\{\{\/ifItemsCategory2\}\}/g, '');
  } else {
    out = out.replace(/\{\{#ifItemsCategory2\}\}/g, '').replace(/\{\{\/ifItemsCategory2\}\}/g, '');
  }
  // Build {{categoriesSections}}: all Category 1 sections (dashed-line between sections only; no extra dash before first so layout matches original).
  const categories = Array.isArray(data.categories) ? data.categories : [];
  const categoriesSectionsHtml =
    categories.length > 0
      ? categories
          .map((c, i) => {
            const sectionHtml = `<div class="category-section">\n    <div class="category-title">${escapeLabelText((c.categoryName || 'Kategori').trim() || 'Kategori')}:</div>\n    ${typeof c.itemsHtml === 'string' ? c.itemsHtml : ''}\n  </div>`;
            return i === 0 ? sectionHtml : `<div class="dashed-line"></div>\n  ${sectionHtml}`;
          })
          .join('\n  ')
      : `${(itemsHtmlCategory1 || '').trim() ? `<div class="category-section">\n    <div class="category-title">${category1Name}:</div>\n    ${itemsHtmlCategory1}\n  </div>` : ''}${hasItemsCategory2 ? `\n  <div class="dashed-line"></div>\n  <div class="category-section">\n    <div class="category-title">${category2Name}:</div>\n    ${itemsHtmlCategory2}\n  </div>` : ''}`;
  const itemNumStr = String(itemNumber);
  const totalStr = String(totalItems);
  out = out
    .replace(/\{\{leftPadding\}\}/g, leftPadding)
    .replace(/\{\{rightPadding\}\}/g, rightPadding)
    .replace(/\{\{counter\}\}/g, String(counter))
    .replace(/\{\{\s*itemNumber\s*\}\}/gi, itemNumStr)
    .replace(/\{\{\s*totalItems\s*\}\}/gi, totalStr)
    .replace(/\{\{pickupMethod\}\}/g, pickupLabel)
    .replace(/\{\{productName\}\}/g, productName)
    .replace(/\{\{customizations\}\}/g, customizations)
    .replace(/\{\{\s*orderTime\s*\}\}/g, orderTime)
    .replace(/\{\{labelContinuation\}\}/g, labelContinuation)
    .replace(/\{\{waiterName\}\}/g, waiterName)
    .replace(/\{\{customerName\}\}/g, customerName)
    .replace(/\{\{tableName\}\}/g, tableName)
    .replace(/\{\{items\}\}/g, itemsHtml)
    .replace(/\{\{categoriesSections\}\}/g, categoriesSectionsHtml)
    .replace(/\{\{itemsCategory1\}\}/g, itemsHtmlCategory1)
    .replace(/\{\{itemsCategory2\}\}/g, itemsHtmlCategory2)
    .replace(/\{\{category1Name\}\}/g, category1Name)
    .replace(/\{\{category2Name\}\}/g, category2Name);
  // Order-summary checker slip: do not show datetime at bottom (user requested). Per-item labels still show time.
  const isOrderSummarySlip =
    ((data.items != null && String(data.items).trim() !== '') || (Array.isArray(data.categories) && data.categories.length > 0)) &&
    !(data.productName != null && String(data.productName).trim() !== '');
  const timeDivRegex = /<div\s+class="time"[^>]*>[\s\S]*?<\/div>/gi;
  if (isOrderSummarySlip) {
    out = out.replace(timeDivRegex, '');
  } else {
    out = out.replace(timeDivRegex, `<div class="time">${orderTime}</div>`);
  }
  const hasTimeInOutput = out.includes('class="time"');
  // Only inject footer when template had no .time div; never inject for checker order-summary slip
  if (!hasTimeInOutput && !isOrderSummarySlip) {
    const footerBlock = `<div class="footer" style="margin-top:2mm;"><div class="time">${orderTime}</div></div>`;
    if (out.includes('</body>')) {
      out = out.replace('</body>', `${footerBlock}</body>`);
    }
  }
  // is40mmLabel: template is for 40mm kitchen labels (@page size 40mm). When true we inject NO extra CSS so the printed result matches the saved template exactly (font, position, layout).
  const is40mmLabel = out.includes('@page') && out.includes('40mm');
  // Normalize 40mm label height: saved templates may have "40mm auto" (long page). Force 40mm × 30mm so print/PDF is fixed height (runtime evidence: DB template "Momoyo Label" had 40mm auto).
  if (is40mmLabel && /40mm\s+auto/.test(out)) {
    out = out.replace(/40mm\s+auto/g, '40mm 30mm');
    console.log('[LABEL] Normalized @page to 40mm × 30mm (was 40mm auto)');
  }
  // Pin 40mm label content to top-left of page so PDF/print don't place it at bottom-right (avoids blank area when printing the PDF).
  if (is40mmLabel && out.includes('</head>')) {
    const topLeftStyle = '<style>/* label top-left */ html { height: 100%; margin: 0; } body { margin: 0 !important; position: relative !important; top: 0 !important; left: 0 !important; }</style>';
    out = out.replace('</head>', `${topLeftStyle}</head>`);
  }
  // addedWrap: whether we injected "wrap" CSS (word-wrap/overflow-wrap, table fixed width) to prevent text cutoff on narrow printers. We skip this for 40mm labels so layout stays exactly as in the template.
  const hasOverflowWrap = /\boverflow-wrap\s*:\s*break-word\b/.test(out) || out.includes('overflow-wrap:break-word');
  const wrapStyle = '<style>body{word-wrap:break-word;overflow-wrap:break-word;max-width:100%;box-sizing:border-box;}table{table-layout:fixed;width:100%;}td,th{word-wrap:break-word;overflow-wrap:break-word;}</style>';
  const addedWrap = out.includes('</head>') && !hasOverflowWrap && !is40mmLabel;
  if (addedWrap) {
    out = out.replace('</head>', `${wrapStyle}</head>`);
  }
  // addItemLineStyle: whether we injected CSS for ".item-line" (order-summary / multi-line checker layouts). We skip this for 40mm labels so the template is not modified.
  const addItemLineStyle = out.includes('</head>') && !out.includes('checker-item-line-align') && !is40mmLabel;
  if (addItemLineStyle) {
    const itemLineStyle = '<style>/* checker-item-line-align */.item-line, .item-line.package-subitem, tr.package-subitem td:first-child { padding-left: 0 !important; margin: 0 !important; padding-top: 0 !important; padding-bottom: 0 !important; line-height: 1.2 !important; }</style>';
    out = out.replace('</head>', `${itemLineStyle}</head>`);
  }
  return out;
}

/** Merge multiple full-document label HTMLs into one document (for batch print). */
function mergeLabelHtmlsIntoOne(fullHtmls: string[]): string {
  if (fullHtmls.length === 0) return '';
  if (fullHtmls.length === 1) return fullHtmls[0];
  const first = fullHtmls[0];
  const firstBodyMatch = first.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const firstBodyRaw = firstBodyMatch ? firstBodyMatch[1] : '';
  // Wrap first label in .label-page too so it gets a page break (otherwise 1st and 2nd print on one physical label)
  const firstBody = firstBodyRaw ? `<div class="label-page">${firstBodyRaw}</div>` : '';
  const restBodies = fullHtmls.slice(1).map((html) => {
    const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    return m ? `<div class="label-page">${m[1]}</div>` : '';
  }).join('');
  const labelPageStyle = `
    .label-page { page-break-after: always; }
    .label-page:last-child { page-break-after: auto; }
  `;
  const headMatch = first.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const headContent = headMatch ? headMatch[1] : '';
  const headWithStyle = headContent.includes('.label-page')
    ? headContent
    : headContent.replace('</style>', `${labelPageStyle}</style>`);
  return first
    .replace(/<head[^>]*>[\s\S]*?<\/head>/i, `<head>${headWithStyle}</head>`)
    .replace(/<body[^>]*>[\s\S]*<\/body>/i, `<body>${firstBody}${restBodies}</body>`);
}

// Generate label HTML for order items (fallback when no checker template)
function generateLabelHTML(data: LabelPrintData): string {
  const formatDateTime = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  const counter = data.counter || 0;
  const itemNumber = data.itemNumber || 0;
  const totalItems = data.totalItems || 0;
  const pickupMethod = data.pickupMethod || 'dine-in';
  const productName = data.productName || '';
  const customizations = data.customizations || '';
  const labelContinuation = data.labelContinuation || '';
  const orderTime = data.orderTime ? formatDateTime(new Date(data.orderTime)) : formatDateTime(new Date());

  const pickupLabel = pickupMethod === 'dine-in' ? 'DINE IN' : 'TAKE AWAY';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { 
      size: 40mm 30mm; 
      margin: 0;
    }
    * { 
      margin: 0; 
      padding: 0; 
      box-sizing: border-box; 
      color: black; 
    }
    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      width: 22ch;
      max-width: 22ch;
      font-size: 8pt;
      font-weight: 600;
      line-height: 1.4;
      padding: 3mm 0 3mm 3mm;
      word-wrap: break-word;
      overflow-wrap: break-word;
      color: black;
    }
    .content {
    }
    .row {
      display: table;
      width: calc(100% + 3mm);
      table-layout: fixed;
      margin-right: -3mm;
    }
    .row > div {
      display: table-cell;
    }
    .counter {
      font-size: 9pt;
      font-weight: 700;
    }
    .pickup {
      text-align: left;
      font-size: 7pt;
      font-weight: 700;
      text-transform: uppercase;
    }
    .product {
      text-align: left;
      font-size: 7pt;
      font-weight: 600;
    }
    .customizations {
      text-align: left;
      font-size: 7pt;
      font-weight: 500;
    }
    .number {
      font-size: 9pt;
      font-weight: 700;
      text-align: right;
    }
    .continuation {
      font-size: 7pt;
      font-weight: 600;
      color: #666;
      text-align: center;
    }
    .footer {
      margin-top: 2mm;
    }
    .time {
      text-align: left;
      font-size: 7pt;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="content">
    <div class="row">
      <div class="counter">${counter}</div>
      ${labelContinuation ? `<div class="continuation">${labelContinuation}</div>` : '<div class="continuation"></div>'}
      <div class="number">${itemNumber}/${totalItems}</div>
    </div>
    <div class="pickup">${pickupLabel}</div>
    <div class="product">${productName}</div>
    ${customizations ? `<div class="customizations">${customizations}</div>` : ''}
  </div>
  <div class="footer">
    <div class="time">${orderTime}</div>
  </div>
</body>
</html>
  `;
}

// Generate HTML for multiple labels in a single document (batch printing)
function generateMultipleLabelsHTML(labels: LabelPrintData[]): string {
  const formatDateTime = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  const labelHTMLs = labels.map((data) => {
    const counter = data.counter || 0;
    const itemNumber = data.itemNumber || 0;
    const totalItems = data.totalItems || 0;
    const pickupMethod = data.pickupMethod || 'dine-in';
    const productName = data.productName || '';
    const customizations = data.customizations || '';
    const labelContinuation = data.labelContinuation || '';
    const orderTime = data.orderTime ? formatDateTime(new Date(data.orderTime)) : formatDateTime(new Date());

    const pickupLabel = pickupMethod === 'dine-in' ? 'DINE IN' : 'TAKE AWAY';

    return `
    <div class="label-page">
      <div class="content">
        <div class="row">
          <div class="counter">${counter}</div>
          ${labelContinuation ? `<div class="continuation">${labelContinuation}</div>` : '<div class="continuation"></div>'}
          <div class="number">${itemNumber}/${totalItems}</div>
        </div>
        <div class="pickup">${pickupLabel}</div>
        <div class="product">${productName}</div>
        ${customizations ? `<div class="customizations">${customizations}</div>` : ''}
      </div>
      <div class="footer">
        <div class="time">${orderTime}</div>
      </div>
    </div>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { 
      size: 40mm 30mm; 
      margin: 0;
    }
    * { 
      margin: 0; 
      padding: 0; 
      box-sizing: border-box; 
      color: black; 
    }
    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      width: 22ch;
      max-width: 22ch;
      font-size: 8pt;
      font-weight: 600;
      line-height: 1.4;
      word-wrap: break-word;
      overflow-wrap: break-word;
      color: black;
    }
    .label-page {
      padding: 3mm 0 3mm 3mm;
      min-height: 30mm;
      page-break-after: always;
    }
    .label-page:last-child {
      page-break-after: auto;
    }
    .content {
    }
    .row {
      display: table;
      width: calc(100% + 3mm);
      table-layout: fixed;
      margin-right: -3mm;
    }
    .row > div {
      display: table-cell;
    }
    .counter {
      font-size: 9pt;
      font-weight: 700;
    }
    .pickup {
      text-align: left;
      font-size: 7pt;
      font-weight: 700;
      text-transform: uppercase;
    }
    .product {
      text-align: left;
      font-size: 7pt;
      font-weight: 600;
    }
    .customizations {
      text-align: left;
      font-size: 7pt;
      font-weight: 500;
    }
    .number {
      font-size: 9pt;
      font-weight: 700;
      text-align: right;
    }
    .continuation {
      font-size: 7pt;
      font-weight: 600;
      color: #666;
      text-align: center;
    }
    .footer {
      margin-top: 2mm;
    }
    .time {
      text-align: left;
      font-size: 7pt;
      font-weight: 500;
    }
  </style>
</head>
<body>
  ${labelHTMLs}
</body>
</html>
  `;
}

/** Parse package_selections_json into lines { product_name, quantity, note? } (quantity already * packageQuantity). */
function parsePackageBreakdownFromJson(rawJson: unknown, packageQuantity: number): { product_name: string; quantity: number; note?: string }[] {
  const lines: { product_name: string; quantity: number; note?: string }[] = [];
  if (packageQuantity <= 0) return lines;
  let arr: unknown[];
  if (typeof rawJson === 'string') {
    try {
      const parsed = JSON.parse(rawJson);
      arr = Array.isArray(parsed) ? parsed : [];
    } catch {
      return lines;
    }
  } else if (Array.isArray(rawJson)) {
    arr = rawJson;
  } else {
    return lines;
  }
  for (const sel of arr) {
    if (!sel || typeof sel !== 'object') continue;
    const s = sel as Record<string, unknown>;
    const st = s.selection_type as string | undefined;
    if (st === 'default') {
      const name = (s.product_name as string) ?? (s.nama as string) ?? '';
      const qty = typeof s.quantity === 'number' && !Number.isNaN(s.quantity) ? s.quantity : 0;
      const note = s.note != null && String(s.note).trim() ? String(s.note).trim() : undefined;
      if (name || qty > 0) lines.push({ product_name: String(name), quantity: qty * packageQuantity, note });
    } else if (st === 'flexible' && Array.isArray(s.chosen)) {
      for (const c of s.chosen) {
        if (!c || typeof c !== 'object') continue;
        const cc = c as Record<string, unknown>;
        const cqty = typeof cc.quantity === 'number' && !Number.isNaN(cc.quantity) ? cc.quantity : 0;
        if (cqty > 0) {
          const cname = (cc.product_name as string) ?? (cc.nama as string) ?? '';
          const cnote = cc.note != null && String(cc.note).trim() ? String(cc.note).trim() : undefined;
          lines.push({ product_name: String(cname), quantity: cqty * packageQuantity, note: cnote });
        }
      }
    }
  }
  return lines;
}

/** Strip trailing " (anything)" from a name for receipt display (no package name on receipt). */
function stripPackageNameParenthetical(name: string): string {
  const s = String(name ?? '').trim();
  const m = s.match(/^(.+?)\s+\([^)]*\)\s*$/);
  return m ? m[1].trim() : s;
}

/** Common size codes (first word = size). Otherwise use "QTY Name" to avoid corrupting names like "Ayam Goreng" or "Es Teh". */
const SIZE_PREFIX = /^(L|M|S|R|XL|XXL|XS|XXS)$/i;
function formatPackageLineDisplay(productName: string, quantity: number): string {
  const t = String(productName ?? '').trim();
  const m = t.match(/^(\S+)(?:\s+(.*))?$/);
  if (!m) return `${quantity} ${t}`;
  const [, first, rest] = m;
  if (rest !== undefined && SIZE_PREFIX.test(first)) return `${first} ${quantity} ${rest}`;
  return `${quantity} ${t}`;
}

/** Detect flattened package sub-row: total_price 0 and (name starts with 4 spaces, or first line matches "Nx ProductName (PackageName)"). */
function isFlattenedPackageSubItem(item: any): boolean {
  if (item.total_price !== 0) return false;
  const name = String(item.name ?? '').trimStart();
  if (name.startsWith('    ')) return true;
  const firstLine = name.split('\n')[0].trim();
  return /^\d+x\s+.+\s+\([^)]+\)$/.test(firstLine);
}

/** Build items table HTML for receipt/bill/checker. Package products: main line + indented bullet sub-items (no price columns on bullets). */
function buildItemsHtmlForPrint(
  items: any[],
  options: { showPrices: boolean; showNotes: boolean }
): string {
  const { showPrices, showNotes } = options;
  const out: string[] = [];
  for (const item of items) {
    const name = item.name || item.product?.nama || '';
    const qty = item.quantity || 1;
    const price = item.price || item.unit_price || 0;
    const subtotal = item.total_price || (price * qty);
    if (isFlattenedPackageSubItem(item)) {
      // Receipt: no note and no (package name) for package sub-items
      let displayName = String(name).trim();
      const noteLineMatch = displayName.match(/\nnote:\s*.+/i);
      if (noteLineMatch) displayName = displayName.slice(0, displayName.indexOf(noteLineMatch[0])).trim();
      displayName = stripPackageNameParenthetical(displayName);
      const safeName = displayName
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        .replace(/\n/g, '<br/>');
      out.push(`
      <tr class="package-subitem">
        <td colspan="4" style="text-align: left; padding-left: 5mm; padding-bottom: 0.3mm; font-size: 9pt;">${safeName}</td>
      </tr>`);
      continue;
    }
    const noteParts: string[] = [];
    if (showNotes && item.custom_note && String(item.custom_note).trim()) {
      noteParts.push(String(item.custom_note).trim());
    }
    if (showNotes && item.customizations) {
      const cust = item.customizations;
      const custStr = typeof cust === 'string' ? cust : (Array.isArray(cust) ? cust.map((c: any) => c?.customization_name || c?.option_name || c?.name || String(c)).filter(Boolean).join(', ') : '');
      if (custStr.trim()) noteParts.push(custStr.trim());
    }
    const noteLine = noteParts.length ? noteParts.join(' | ') : '';
    const noteRow = showNotes && noteLine ? `<tr><td colspan="4" style="text-align: left; padding-bottom: 0.5mm; font-size: 8pt; color: #555;">${noteLine}</td></tr>` : '';

    let breakdownLines: { product_name: string; quantity: number; note?: string }[] | undefined = item.packageBreakdownLines;
    if (!breakdownLines?.length && (item.package_selections_json != null || item.packageSelections != null)) {
      const raw = item.package_selections_json ?? (item.packageSelections && typeof item.packageSelections === 'object' ? JSON.stringify(item.packageSelections) : null);
      breakdownLines = raw != null ? parsePackageBreakdownFromJson(raw, qty) : undefined;
    }

    if (breakdownLines && breakdownLines.length > 0) {
      // Package: main line (name, price, qty, subtotal) then indented bullet sub-items (no price columns). Receipt: no per-item note, no (package name).
      out.push(`
      <tr>
        <td colspan="4" style="text-align: left; padding-bottom: 0.5mm;">${name}</td>
      </tr>
      <tr>
        <td style="width: 30%;"></td>
        <td style="width: 25%; text-align: right; padding-top: 0;">${showPrices ? price.toLocaleString('id-ID') : ''}</td>
        <td style="width: 20%; text-align: right; padding-top: 0;">${qty}</td>
        <td style="width: 25%; text-align: right; padding-top: 0;">${showPrices ? subtotal.toLocaleString('id-ID') : ''}</td>
      </tr>
      ${noteRow}`);
      for (const line of breakdownLines) {
        const displayName = stripPackageNameParenthetical(line.product_name);
        const lineText = formatPackageLineDisplay(displayName, line.quantity);
        out.push(`
      <tr>
        <td colspan="4" style="text-align: left; padding-left: 5mm; padding-bottom: 0.3mm; font-size: 9pt;">• ${lineText}</td>
      </tr>`);
      }
    } else {
      // Bundle or regular: single line(s) as before
      out.push(`
      <tr>
        <td colspan="4" style="text-align: left; padding-bottom: 0.5mm;">${name}</td>
      </tr>
      <tr>
        <td style="width: 30%;"></td>
        <td style="width: 25%; text-align: right; padding-top: 0;">${showPrices ? price.toLocaleString('id-ID') : ''}</td>
        <td style="width: 20%; text-align: right; padding-top: 0;">${qty}</td>
        <td style="width: 25%; text-align: right; padding-top: 0;">${showPrices ? subtotal.toLocaleString('id-ID') : ''}</td>
      </tr>
      ${noteRow}`);
    }
  }
  return out.join('');
}

// Generate transaction receipt HTML
function generateReceiptHTML(data: ReceiptPrintData, businessName: string, options?: ReceiptFormattingOptions): string {
  const marginAdjust = options?.marginAdjustMm ?? 0;
  const baseLeftPadding = 7;
  const baseRightPadding = 7;
  const leftPadding = Math.max(0, baseLeftPadding - marginAdjust);
  const rightPadding = Math.max(0, baseRightPadding + marginAdjust);

  const items = data.items || [];
  // Subtotal (Total Harga) = sum of items before discount
  const itemsSum = items.reduce((sum: number, item: ReceiptLineItem) => sum + (Number(item.total_price) || 0), 0);
  const subTotal = typeof data.total === 'number' && data.total >= 0 ? data.total : (itemsSum > 0 ? itemsSum : 0);
  const voucherDiscount = typeof data.voucherDiscount === 'number' && data.voucherDiscount > 0 ? data.voucherDiscount : 0;
  // Grand total (Pembayaran Sebenarnya) = subtotal - voucher discount, or use final_amount when provided
  const grandTotal = typeof data.final_amount === 'number' && data.final_amount >= 0
    ? data.final_amount
    : Math.max(0, subTotal - voucherDiscount);
  const paymentMethod = data.paymentMethod || 'Cash';
  const amountReceived = data.amountReceived || 0;
  const change = data.change || 0;

  // Calculate total items for summary
  const totalItems = items.reduce((sum: number, item: ReceiptLineItem) => sum + (item.quantity || 1), 0);

  // Generate items HTML (package breakdown as indented bullets; note/customization only when options.showNotes is true)
  const showNotes = options?.showNotes === true;
  const itemsHTML = buildItemsHtmlForPrint(items, { showPrices: true, showNotes });

  // Format date as YYYY-MM-DD HH:MM:SS
  const formatDateTime = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  const currentDate = new Date(data.date || Date.now());
  const orderTime = formatDateTime(currentDate);
  const printTime = formatDateTime(new Date());

  // Determine transaction type display (DINE IN / TAKE AWAY)
  const pickupMethod = data.pickupMethod || 'dine-in';
  const isDineIn = pickupMethod === 'dine-in';
  const transactionDisplay = isDineIn ? 'DINE IN' : 'TAKE AWAY';
  const logoDataUri = getLogoBase64();

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      width: 42ch;
      max-width: 42ch;
      font-size: 10pt;
      font-weight: 500;
      line-height: 1.2;
      padding: 2mm ${rightPadding.toFixed(2)}mm 2mm ${leftPadding.toFixed(2)}mm;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .contact { text-align: center; font-size: 8pt; font-weight: 600; margin-bottom: 1mm; }
    .logo-container { text-align: center; margin-bottom: 1mm; }
    .logo { max-width: 100%; height: auto; max-height: 18mm; }
    .store-name { text-align: center; font-size: 13pt; font-weight: bold; margin-bottom: 1mm; }
    .branch { text-align: center; font-size: 11pt; font-weight: 600; margin-bottom: 1mm; }
    .address { text-align: center; font-size: 8pt; font-weight: 500; margin-bottom: 1.5mm; max-width: 100%; line-height: 1.3; }
    .transaction-type { text-align: center; font-size: 10pt; font-weight: 700; margin-bottom: 1.5mm; }
    .dashed-line { border-top: 1px dashed #000; margin: 1.5mm 0; }
    .info-line { display: flex; justify-content: space-between; margin-bottom: 0.5mm; }
    .info-label { font-size: 9pt; font-weight: 500; }
    .info-value { font-size: 9pt; font-weight: 700; }
    .order-number-value { font-size: 9pt; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin: 1mm 0; font-size: 9pt; }
    th { text-align: left; font-weight: 700; border-bottom: 1px solid #000; padding: 0.5mm 0; font-size: 8pt; }
    td { padding: 0.5mm 0; font-weight: 500; }
    .summary-line { display: flex; justify-content: space-between; margin-bottom: 0.5mm; font-size: 9pt; font-weight: 500; }
    .summary-label { font-weight: 500; }
    .summary-value { font-weight: 700; }
    .footer { margin-top: 2mm; font-size: 8pt; text-align: center; line-height: 1.3; font-weight: 500; }
  </style>
</head>
<body>
  ${logoDataUri ? `<div class="logo-container"><img src="${logoDataUri}" class="logo" alt="Momoyo Logo"></div>` : '<div class="store-name">MOMOYO</div>'}
  <div class="branch">${businessName}</div>
  ${data.isReprint && data.reprintCount ? `<div class="reprint-notice" style="text-align: center; font-size: 10pt; font-weight: bold; margin: 1mm 0; color: #000;">REPRINT KE-${data.reprintCount}</div>` : ''}
  <div class="address">Jl. Kalimantan no. 21, Kartoharjo<br>Kec. Kartoharjo, Kota Madiun</div>
  <div class="contact">silahkan hubungi: 0813-9888-8568</div>
  
  ${(() => {
      // Choose per-printer display number: Each printer type uses its own daily counter
      // Printer 1 (receiptPrinter) uses printer1Counter from receiptPrinter counter
      // Printer 2 (receiptizePrinter) uses printer2Counter from receiptizePrinter counter
      // Fall back to globalCounter, then tableNumber, then '01'
      const isReceiptize = data.printerType === 'receiptizePrinter';
      // Prioritize per-printer counter over globalCounter to ensure each printer has its own counter
      const perPrinterCounter = isReceiptize ? data.printer2Counter : data.printer1Counter;

      // Debug: Log all available counter values
      console.log(`📄 [RECEIPT] Counter selection - printerType: ${data.printerType}, isReceiptize: ${isReceiptize}`);
      console.log(`📄 [RECEIPT] Available counters - printer1Counter: ${data.printer1Counter} (type: ${typeof data.printer1Counter}), printer2Counter: ${data.printer2Counter} (type: ${typeof data.printer2Counter}), globalCounter: ${data.globalCounter}, tableNumber: ${data.tableNumber}`);
      console.log(`📄 [RECEIPT] Selected perPrinterCounter: ${perPrinterCounter} (type: ${typeof perPrinterCounter})`);

      // Use per-printer counter if it's a valid number > 0, otherwise fall back
      let displayCounter: string | number;
      if (typeof perPrinterCounter === 'number' && perPrinterCounter > 0) {
        displayCounter = perPrinterCounter;
        console.log(`✅ [RECEIPT] Using per-printer counter: ${displayCounter}`);
      } else if (typeof data.globalCounter === 'number' && data.globalCounter > 0) {
        displayCounter = data.globalCounter;
        console.log(`⚠️ [RECEIPT] Per-printer counter invalid, using globalCounter: ${displayCounter}`);
      } else if (data.tableNumber) {
        displayCounter = data.tableNumber;
        console.log(`⚠️ [RECEIPT] Using tableNumber as fallback: ${displayCounter}`);
      } else {
        displayCounter = '01';
        console.log(`❌ [RECEIPT] All counters invalid, using default '01'`);
      }

      const numStr = String(displayCounter).padStart(2, '0');

      console.log(`📄 [RECEIPT] Final counter display - displayCounter: ${displayCounter}, numStr: ${numStr}, will show: ${transactionDisplay} ${numStr}`);

      return `<div class="transaction-type">${transactionDisplay} ${numStr}</div>`;
    })()}
  
  <div class="dashed-line"></div>
  
  <div class="info-line">
    <span class="info-label">Nomor Pesanan:</span>
    <span class="info-value order-number-value mono-value">${data.receiptNumber || data.id || 'N/A'}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Waktu Pesanan:</span>
    <span class="info-value mono-value">${orderTime}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Waktu Print:</span>
    <span class="info-value mono-value">${printTime}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Operator Kasir:</span>
    <span class="info-value">${data.cashier || 'N/A'}</span>
  </div>
  <div class="info-line">
    <span class="info-label">Nama Pelanggan:</span>
    <span class="info-value">${(data.customerName || data.customer_name || '').trim() || '-'}</span>
  </div>
  
  <div class="dashed-line"></div>
  
  <table>
    <tr>
      <th style="width: 30%;">Nama Produk</th>
      <th style="width: 25%; text-align: right;">Harga</th>
      <th style="width: 20%; text-align: right;">Jumlah</th>
      <th style="width: 25%; text-align: right;">Subtotal</th>
    </tr>
    ${itemsHTML}
  </table>
  
  <div class="dashed-line"></div>
  
  <div class="summary-line">
    <span class="summary-label">Total Pesanan:</span>
    <span class="summary-value">${totalItems}</span>
  </div>
  <div class="summary-line">
    <span class="summary-label">Total Harga:</span>
    <span class="summary-value">${subTotal.toLocaleString('id-ID')}</span>
  </div>
  ${voucherDiscount > 0 ? `
  <div class="summary-line">
    <span class="summary-label">Diskon (${(data.voucherLabel || 'Voucher').trim() || 'Voucher'}):</span>
    <span class="summary-value">-${voucherDiscount.toLocaleString('id-ID')}</span>
  </div>
  <div class="summary-line">
    <span class="summary-label">Total Bayar:</span>
    <span class="summary-value">${grandTotal.toLocaleString('id-ID')}</span>
  </div>
  ` : ''}
  
  <div class="dashed-line"></div>
  
  <div class="summary-line">
    <span class="summary-label">Metode Pembayaran:</span>
    <span class="summary-value">${paymentMethod}</span>
  </div>
  ${amountReceived > 0 ? `
  <div class="summary-line">
    <span class="summary-label">Bayar Jumlah:</span>
    <span class="summary-value">${amountReceived.toLocaleString('id-ID')}</span>
  </div>
  <div class="summary-line">
    <span class="summary-label">Kembali Uang Kecil:</span>
    <span class="summary-value">${change.toLocaleString('id-ID')}</span>
  </div>
  ` : ''}
  <div class="summary-line">
    <span class="summary-label">Pembayaran Sebenarnya:</span>
    <span class="summary-value">${grandTotal.toLocaleString('id-ID')}</span>
  </div>
  
  <div class="dashed-line"></div>
  
  <div class="footer">
    <p>Pendapat Anda sangat penting bagi kami.</p>
    <p>Untuk kritik dan saran silahkan hubungi :</p>
    <p>0812-1822-2666</p>
    <p style="margin-top: 2mm;">Untuk layanan kemitraan dan partnership</p>
  </div>
</body>
</html>
  `;
}

// Generate shift breakdown report HTML for printing
function generateShiftBreakdownHTML(
  shiftData: PrintableShiftReportSection & { businessName?: string; wholeDayReport?: PrintableShiftReportSection | null; sectionOptions?: { ringkasan?: boolean; barangTerjual?: boolean; paymentMethod?: boolean; categoryI?: boolean; categoryII?: boolean; paket?: boolean; toppingSales?: boolean; itemDibatalkan?: boolean } }
): string {
  const formatDateTime = (dateString: string): string => {
    const date = new Date(dateString);
    const gmt7Date = new Date(date.getTime() + (7 * 60 * 60 * 1000));
    const year = gmt7Date.getUTCFullYear();
    const month = String(gmt7Date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(gmt7Date.getUTCDate()).padStart(2, '0');
    const hours = String(gmt7Date.getUTCHours()).padStart(2, '0');
    const minutes = String(gmt7Date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(gmt7Date.getUTCSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  // Round to integer and format as id-ID to avoid decimals (e.g. ",002") from floating point
  const formatIntegerId = (value: number): string => {
    const n = Number.isFinite(value) ? Math.round(value) : 0;
    return n.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };

  const formatPlatformLabel = (platform: string): string => {
    const key = (platform || 'offline').toLowerCase();
    switch (key) {
      case 'offline':
        return 'Offline';
      case 'gofood':
        return 'GoFood';
      case 'grabfood':
        return 'GrabFood';
      case 'shopeefood':
        return 'ShopeeFood';
      case 'qpon':
        return 'Qpon';
      case 'tiktok':
        return 'TikTok';
      default:
        return key.charAt(0).toUpperCase() + key.slice(1);
    }
  };

  const formatTransactionLabel = (transactionType: string): string => {
    return transactionType === 'bakery' ? 'Bakery' : 'Drinks';
  };

  const printTime = formatDateTime(new Date().toISOString());

  const renderReportSection = (
    report: PrintableShiftReportSection,
    options: { titleOverride?: string; businessName?: string; sectionOptions?: { ringkasan?: boolean; barangTerjual?: boolean; paymentMethod?: boolean; categoryI?: boolean; categoryII?: boolean; paket?: boolean; toppingSales?: boolean; itemDibatalkan?: boolean } } = {}
  ): string => {
    const sectionTitle = options.titleOverride || report.title || 'LAPORAN SHIFT';
    const businessName = options.businessName || shiftData.businessName || 'Momoyo Bakery Kalimantan';
    // Use sectionOptions from options directly if provided, otherwise use defaults
    // This ensures we respect false values from the caller
    const providedSectionOptions = options.sectionOptions;

    // Debug logging
    writeDebugLog(JSON.stringify({
      location: 'electron/main.ts:8453',
      message: 'RENDER SECTION - Options sectionOptions',
      data: options.sectionOptions,
      timestamp: Date.now(),
      sessionId: 'debug-session',
      runId: 'post-fix',
      hypothesisId: 'C'
    }));

    console.log('🔍 [RENDER SECTION] Options sectionOptions:', JSON.stringify(options.sectionOptions));
    console.log('🔍 [RENDER SECTION] Using provided options directly:', providedSectionOptions !== undefined && providedSectionOptions !== null);

    const sectionOptions = providedSectionOptions ? {
      ringkasan: providedSectionOptions.ringkasan !== undefined ? providedSectionOptions.ringkasan : true,
      barangTerjual: providedSectionOptions.barangTerjual !== undefined ? providedSectionOptions.barangTerjual : true,
      paymentMethod: providedSectionOptions.paymentMethod !== undefined ? providedSectionOptions.paymentMethod : true,
      categoryI: providedSectionOptions.categoryI !== undefined ? providedSectionOptions.categoryI : true,
      categoryII: providedSectionOptions.categoryII !== undefined ? providedSectionOptions.categoryII : true,
      paket: providedSectionOptions.paket !== undefined ? providedSectionOptions.paket : true,
      toppingSales: providedSectionOptions.toppingSales !== undefined ? providedSectionOptions.toppingSales : true,
      itemDibatalkan: (providedSectionOptions as { itemDibatalkan?: boolean }).itemDibatalkan !== undefined ? (providedSectionOptions as { itemDibatalkan?: boolean }).itemDibatalkan : true
    } : {
      ringkasan: true,
      barangTerjual: true,
      paymentMethod: true,
      categoryI: true,
      categoryII: true,
      paket: true,
      toppingSales: true,
      itemDibatalkan: true
    };

    // Debug logging
    writeDebugLog(JSON.stringify({
      location: 'electron/main.ts:8475',
      message: 'RENDER SECTION - Final resolved sectionOptions',
      data: sectionOptions,
      timestamp: Date.now(),
      sessionId: 'debug-session',
      runId: 'post-fix',
      hypothesisId: 'C'
    }));
    writeDebugLog(JSON.stringify({
      location: 'electron/main.ts:8476',
      message: 'RENDER SECTION - Check values',
      data: {
        barangTerjual: sectionOptions.barangTerjual,
        barangTerjualType: typeof sectionOptions.barangTerjual,
        barangTerjualEqualTrue: sectionOptions.barangTerjual === true
      },
      timestamp: Date.now(),
      sessionId: 'debug-session',
      runId: 'post-fix',
      hypothesisId: 'C'
    }));

    console.log('🔍 [RENDER SECTION] Final resolved sectionOptions:', JSON.stringify(sectionOptions));
    console.log('🔍 [RENDER SECTION] barangTerjual value:', sectionOptions.barangTerjual, 'type:', typeof sectionOptions.barangTerjual, '=== true:', sectionOptions.barangTerjual === true);
    const shiftStartTime = formatDateTime(report.shift_start);
    const shiftEndTime = report.shift_end ? formatDateTime(report.shift_end) : 'Masih Berlangsung';

    const sortedProducts = [...report.productSales].sort((a, b) => {
      const aIsBundle = Boolean(a.is_bundle_item);
      const bIsBundle = Boolean(b.is_bundle_item);
      if (aIsBundle && !bIsBundle) return 1;
      if (!aIsBundle && bIsBundle) return -1;
      return 0;
    });

    const productRows = sortedProducts.map(product => {
      try {
        const quantity = product.total_quantity || 0;
        const baseSubtotal = product.base_subtotal ?? (product.total_subtotal - product.customization_subtotal);
        // Always calculate unit price from baseSubtotal/quantity (excludes customizations)
        const unitPrice = quantity > 0 ? baseSubtotal / quantity : 0;
        const platformLabel = formatPlatformLabel(product.platform);
        const transactionLabel = formatTransactionLabel(product.transaction_type);
        const isBundleItem = Boolean(product.is_bundle_item);

        // Validate numeric values
        if (isNaN(quantity) || isNaN(baseSubtotal) || isNaN(unitPrice)) {
          console.error(`❌ [HTML GEN] Invalid numbers in product: ${product.product_name}`, {
            quantity, baseSubtotal, unitPrice
          });
        }

        if (isBundleItem) {
          console.log(`[SHIFT PRINT] Displaying bundle item: ${product.product_name}, is_bundle_item: ${product.is_bundle_item}`);
        }
        const productNameDisplay = isBundleItem
          ? `<span style="font-size: 4.8pt;">(Bundle)</span> ${product.product_name}`
          : product.product_name;
        return `
      <tr>
        <td style="text-align: left; padding: 0.3mm 0;">
          <div>${productNameDisplay}</div>
          <div style="font-size: 7pt; color: #555;">${transactionLabel} · ${platformLabel}</div>
        </td>
        <td style="text-align: left; padding: 0.3mm 0;">${quantity}</td>
        <td style="text-align: left; padding: 0.3mm 0; font-size: 6pt;">${isBundleItem ? '-' : (isNaN(unitPrice) ? '0' : formatIntegerId(unitPrice))}</td>
        <td style="text-align: right; padding: 0.3mm 0;">${isBundleItem ? '-' : (isNaN(baseSubtotal) ? '0' : formatIntegerId(baseSubtotal))}</td>
      </tr>
      `;
      } catch (productError) {
        console.error(`❌ [HTML GEN] Error processing product:`, product, productError);
        return `<tr><td colspan="4">Error processing product: ${product?.product_name || 'Unknown'}</td></tr>`;
      }
    }).join('');

    const regularProducts = report.productSales.filter((p) => !p.is_bundle_item);
    const totalProductQty = report.productSales.reduce((sum, p) => sum + Number(p.total_quantity || 0), 0);
    const totalProductBaseSubtotal = regularProducts.reduce((sum, p) => {
      const baseSubtotal = p.base_subtotal ?? (Number(p.total_subtotal || 0) - Number(p.customization_subtotal || 0));
      return sum + Number(baseSubtotal || 0);
    }, 0);

    const PLATFORM_LABELS_BT: Record<string, string> = { offline: 'Offline', gofood: 'GoFood', grabfood: 'GrabFood', shopeefood: 'ShopeeFood', qpon: 'Qpon', tiktok: 'TikTok' };
    const PLATFORM_ORDER_BT = ['offline', 'gofood', 'grabfood', 'shopeefood', 'qpon', 'tiktok'];
    const productPlatformCount = new Map<string, number>();
    const productPlatformAmount = new Map<string, number>();
    const safeProducts = Array.isArray(regularProducts) ? regularProducts.filter((p) => p != null) : [];
    safeProducts.forEach((p: { platform?: string | string[]; total_quantity?: number; base_subtotal?: number; total_subtotal?: number; customization_subtotal?: number; total_base_subtotal?: number }) => {
      const platformRaw = p.platform;
      const code = typeof platformRaw === 'string' ? platformRaw : (Array.isArray(platformRaw) && platformRaw[0] ? String(platformRaw[0]) : 'offline');
      const platformKey = String(code || 'offline').toLowerCase();
      const platform = PLATFORM_LABELS_BT[platformKey] ? platformKey : 'offline';
      const qty = Number(p.total_quantity ?? 0) || 0;
      const baseSub = p.base_subtotal ?? p.total_base_subtotal;
      const calc = baseSub != null ? Number(baseSub) : (Number(p.total_subtotal ?? 0) - Number(p.customization_subtotal ?? 0));
      const amount = Number.isFinite(calc) ? calc : 0;
      productPlatformCount.set(platform, (productPlatformCount.get(platform) ?? 0) + qty);
      productPlatformAmount.set(platform, (productPlatformAmount.get(platform) ?? 0) + amount);
    });
    const productPlatformBreakdownRows = PLATFORM_ORDER_BT.filter((key) => (productPlatformCount.get(key) ?? 0) > 0).map((key) => {
      const qty = productPlatformCount.get(key) ?? 0;
      const amount = productPlatformAmount.get(key) ?? 0;
      const label = PLATFORM_LABELS_BT[key];
      const amountStr = Number.isFinite(amount) ? formatIntegerId(Math.round(amount)) : '0';
      return `<tr><td style="padding-left: 2mm; font-size: 7pt;">${label}</td><td style="text-align: left; font-size: 7pt;">${qty}</td><td style="text-align: left; font-size: 6pt;">-</td><td class="right" style="font-size: 7pt;">${amountStr}</td></tr>`;
    }).join('');

    const customizationRows = report.customizationSales.map(item => {
      try {
        const quantity = item.total_quantity || 0;
        const revenue = item.total_revenue || 0;

        if (isNaN(quantity) || isNaN(revenue)) {
          console.error(`❌ [HTML GEN] Invalid numbers in customization: ${item.option_name}`, {
            quantity, revenue
          });
        }

        return `
      <tr>
        <td style="text-align: left; padding: 0.3mm 0;">
          <div>${item.option_name || 'Unknown'}</div>
          <div style="font-size: 7pt; color: #555;">${item.customization_name || 'N/A'}</div>
        </td>
        <td style="text-align: left; padding: 0.3mm 0;">${isNaN(quantity) ? '0' : quantity}</td>
        <td style="text-align: right; padding: 0.3mm 0;">${isNaN(revenue) ? '0' : formatIntegerId(Math.round(revenue))}</td>
      </tr>
    `;
      } catch (customizationError) {
        console.error(`❌ [HTML GEN] Error processing customization:`, item, customizationError);
        return `<tr><td colspan="3">Error processing customization</td></tr>`;
      }
    }).join('');

    const totalCustomizationUnits = report.customizationSales.reduce((sum, item) => sum + Number(item.total_quantity || 0), 0);
    const totalCustomizationRevenue = report.customizationSales.reduce((sum, item) => sum + Number(item.total_revenue || 0), 0);

    const paymentRows = report.paymentBreakdown.map(payment => {
      const amount = Number(payment.total_amount || 0);
      const count = Number(payment.transaction_count || 0);
      return `
      <tr>
        <td style="text-align: left; padding: 0.3mm 0;">${payment.payment_method_name || 'N/A'}</td>
        <td style="text-align: left; padding: 0.3mm 0;">${count}</td>
        <td style="text-align: right; padding: 0.3mm 0;">${formatIntegerId(Math.round(amount))}</td>
      </tr>
    `;
    }).join('');

    const totalPaymentCount = report.paymentBreakdown.reduce((sum: number, p) => sum + Number(p.transaction_count || 0), 0);
    const totalPaymentAmount = report.paymentBreakdown.reduce((sum: number, p) => sum + Number(p.total_amount || 0), 0);

    const category1Data = report.category1Breakdown || [];
    const category1Rows = category1Data.map((c1: { category1_name: string; total_quantity: number; total_amount: number }) => {
      const q = Number(c1.total_quantity || 0);
      const a = Math.round(Number(c1.total_amount || 0));
      return `<tr><td style="text-align: left; padding: 0.3mm 0;">${c1.category1_name || 'N/A'}</td><td style="text-align: left; padding: 0.3mm 0;">${q}</td><td style="text-align: right; padding: 0.3mm 0;">${formatIntegerId(a)}</td></tr>`;
    }).join('');
    const totalCategory1Quantity = (report.category1Breakdown || []).reduce((sum: number, c: { total_quantity: number }) => sum + Number(c.total_quantity || 0), 0);
    const totalCategory1Amount = (report.category1Breakdown || []).reduce((sum: number, c: { total_amount: number }) => sum + Number(c.total_amount || 0), 0);

    const category2Data = report.category2Breakdown || [];
    const category2Rows = category2Data.map((category2: { category2_name: string; total_quantity: number; total_amount: number }) => {
      const quantity = Number(category2.total_quantity || 0);
      const amount = Math.round(Number(category2.total_amount || 0));
      return `
      <tr>
        <td style="text-align: left; padding: 0.3mm 0;">${category2.category2_name || 'N/A'}</td>
        <td style="text-align: left; padding: 0.3mm 0;">${quantity}</td>
        <td style="text-align: right; padding: 0.3mm 0;">${formatIntegerId(amount)}</td>
      </tr>
    `;
    }).join('');
    const totalCategory2Quantity = (report.category2Breakdown || []).reduce((sum: number, c: { total_quantity: number }) => sum + Number(c.total_quantity || 0), 0);
    const totalCategory2Amount = (report.category2Breakdown || []).reduce((sum: number, c: { total_amount: number }) => sum + Number(c.total_amount || 0), 0);

    const packageData = Array.isArray((report as any).packageSalesBreakdown)
      ? ((report as any).packageSalesBreakdown as Array<{
        package_product_id: number;
        package_product_name: string;
        total_quantity: number;
        total_amount: number;
        base_unit_price: number;
        lines: Array<{ product_id: number; product_name: string; total_quantity: number }>;
      }>)
      : [];

    const packageRows = packageData
      .map((pkg) => {
        const qty = Number(pkg.total_quantity || 0) || 0;
        const amount = Math.round(Number(pkg.total_amount || 0) || 0);
        const unitPrice = qty > 0 ? amount / qty : 0;
        const header = `
      <tr>
        <td style="text-align: left; padding: 0.3mm 0;">${pkg.package_product_name || 'Unknown Paket'}</td>
        <td style="text-align: left; padding: 0.3mm 0;">${qty}</td>
        <td style="text-align: right; padding: 0.3mm 0;">${formatIntegerId(unitPrice)}</td>
        <td style="text-align: right; padding: 0.3mm 0;">${formatIntegerId(amount)}</td>
      </tr>
        `;
        const lines = Array.isArray(pkg.lines)
          ? pkg.lines
            .filter((l) => l && Number(l.total_quantity || 0) > 0)
            .map((line) => {
              const lineText = formatPackageLineDisplay(String(line.product_name || ''), Number(line.total_quantity || 0));
              return `<tr><td colspan="4" style="text-align: left; padding: 0.2mm 0 0.2mm 2mm; font-size: 7pt; color: #555;">• ${lineText}</td></tr>`;
            })
            .join('')
          : '';
        return header + lines;
      })
      .join('');

    const totalPackageQty = packageData.reduce((sum, p) => sum + Number(p?.total_quantity || 0), 0);
    const totalPackageAmount = packageData.reduce((sum, p) => sum + Number(p?.total_amount || 0), 0);

    // Effective total discount: use sum of voucher breakdown when stats.total_discount is 0 but breakdown has values
    const voucherBreakdownSum = VOUCHER_BREAKDOWN_ORDER.reduce(
      (sum, { key }) => sum + (Number((report.voucherBreakdown || {})[key]?.total) || 0),
      0
    );
    const effectiveTotalDiscount =
      voucherBreakdownSum > 0 ? voucherBreakdownSum : (Number(report.statistics.total_discount) || 0);

    const formattedTotalDiscount = effectiveTotalDiscount > 0
      ? `-${formatIntegerId(Math.abs(effectiveTotalDiscount))}`
      : formatIntegerId(0);
    const cashSummaryData = report.cashSummary;
    // Use refund matching report scope: whole-day (Semua Shift) uses cash_whole_day_refunds, single-shift uses cash_shift_refunds
    const isWholeDayReport = report.user_name === 'Semua Shift';
    const totalRefundsForGrandTotal = isWholeDayReport
      ? Number(cashSummaryData.cash_whole_day_refunds ?? cashSummaryData.cash_shift_refunds ?? 0)
      : Number(cashSummaryData.cash_shift_refunds ?? 0);
    // Coerce to number: IPC can send gross_total_omset as string (e.g. "55771000.00244" from number+string concat on frontend)
    // gross_total_omset includes totalCancelledItemsAmount so Ringkasan can show it as explicit deduction
    const totalCancelledItemsAmount = (report.cancelledItems || []).reduce((s: number, i: { total_price?: number }) => s + Number(i.total_price || 0), 0);
    const grossTotalOmsetRaw = report.gross_total_omset ?? (Number(report.statistics.total_amount || 0) + totalRefundsForGrandTotal + effectiveTotalDiscount + totalCancelledItemsAmount);
    const grossTotalOmset = Math.round(Number(grossTotalOmsetRaw));
    const cashShiftSales = Number(cashSummaryData.cash_shift_sales ?? cashSummaryData.cash_shift ?? 0) || 0;
    const cashShiftRefunds = Number(cashSummaryData.cash_shift_refunds ?? 0) || 0;
    const cashWholeDaySales = Number(cashSummaryData.cash_whole_day_sales ?? cashSummaryData.cash_whole_day ?? 0) || 0;
    const cashWholeDayRefunds = Number(cashSummaryData.cash_whole_day_refunds ?? 0) || 0;
    const cashNetShift = Number(cashSummaryData.cash_shift) || (cashShiftSales - cashShiftRefunds);
    const cashNetWholeDay = Number(cashSummaryData.cash_whole_day) || (cashWholeDaySales - cashWholeDayRefunds);
    // Ensure all values are numbers and handle NaN
    const kasMulaiSummary = Number(cashSummaryData.kas_mulai ?? report.modal_awal ?? 0) || 0;
    const kasExpectedSummary = Number(cashSummaryData.kas_expected) || (kasMulaiSummary + cashShiftSales - cashShiftRefunds);
    // Coerce to number: IPC/JSON can send kas_akhir/kas_selisih as string from DB
    const kasAkhirNum = cashSummaryData.kas_akhir != null && String(cashSummaryData.kas_akhir) !== '' ? Number(cashSummaryData.kas_akhir) : NaN;
    const kasAkhirSummary = Number.isFinite(kasAkhirNum) ? kasAkhirNum : null;
    const kasSelisihRaw = cashSummaryData.kas_selisih != null && String(cashSummaryData.kas_selisih) !== '' ? Number(cashSummaryData.kas_selisih) : NaN;
    const SELISIH_MAX = 1e8; // Reject garbage values
    let kasSelisihSummary: number | null =
      Number.isFinite(kasSelisihRaw) && Math.abs(kasSelisihRaw) <= SELISIH_MAX
        ? Math.round(kasSelisihRaw)
        : null;
    let kasSelisihLabelSummary: 'balanced' | 'plus' | 'minus' | null =
      cashSummaryData.kas_selisih_label ?? null;
    // If payload has no selisih but has kas_akhir and kas_expected, compute so print matches app
    if (kasSelisihSummary === null && kasAkhirSummary !== null && Number.isFinite(kasExpectedSummary)) {
      const computed = Math.round(Number((kasAkhirSummary - kasExpectedSummary).toFixed(2)));
      if (Math.abs(computed) <= SELISIH_MAX) {
        kasSelisihSummary = computed;
        if (Math.abs(kasSelisihSummary) < 1) kasSelisihLabelSummary = 'balanced';
        else if (!kasSelisihLabelSummary) kasSelisihLabelSummary = kasSelisihSummary > 0 ? 'plus' : 'minus';
      }
    }
    if (kasSelisihSummary !== null) {
      if (Math.abs(kasSelisihSummary) < 1) {
        kasSelisihSummary = 0;
        kasSelisihLabelSummary = 'balanced';
      } else if (!kasSelisihLabelSummary) {
        kasSelisihLabelSummary = kasSelisihSummary > 0 ? 'plus' : 'minus';
      }
    }
    // Selisih Kas: no "Rp" on print; + / - before number is enough (no "(Plus)" / "(Minus)" label)
    const varianceValueDisplay =
      kasSelisihSummary === null || isNaN(kasSelisihSummary)
        ? '-'
        : `${kasSelisihSummary > 0 ? '+' : ''}${formatIntegerId(Math.abs(kasSelisihSummary))}`;
    const kasAkhirDisplay = kasAkhirSummary !== null && !isNaN(kasAkhirSummary) ? formatIntegerId(kasAkhirSummary) : '-';
    const totalCashInCashierValue = Number(cashSummaryData.total_cash_in_cashier) || kasExpectedSummary;
    const totalCashInCashierDisplay = !isNaN(totalCashInCashierValue) ? totalCashInCashierValue.toLocaleString('id-ID') : '-';

    const refundList = report.refunds || [];
    const cancelledItemsList = report.cancelledItems || [];
    const refundRows = refundList.map((r: PrintableShiftRefundRow) => {
      const txId = r.transaction_uuid_id || r.transaction_uuid || '-';
      const method = formatPlatformLabel(r.payment_method || 'offline');
      const total = formatIntegerId(Math.round(Number(r.final_amount || 0)));
      const refundAmt = formatIntegerId(Math.round(Number(r.refund_amount || 0)));
      const reason = (r.reason || '-').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const refundTime = r.refunded_at ? formatDateTime(r.refunded_at) : '-';
      const issuer = (r.issuer_email || '-').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const waiter = (r.waiter_name || '-').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const customer = (r.customer_name || '-').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<tr><td style="font-size: 7pt;">${txId}</td><td style="font-size: 7pt;">${method}</td><td class="right" style="font-size: 7pt;">${total}</td><td class="right" style="font-size: 7pt; color: #991b1b;">-${refundAmt}</td><td style="font-size: 7pt;">${reason}</td><td style="font-size: 7pt;">${refundTime}</td><td style="font-size: 7pt;">${issuer}</td><td style="font-size: 7pt;">${waiter}</td><td style="font-size: 7pt;">${customer}</td></tr>`;
    }).join('');

    const cancelledItemsRows = cancelledItemsList.map((item: { product_name: string; quantity: number; total_price: number; cancelled_at: string; cancelled_by_user_name: string; cancelled_by_waiter_name: string; receipt_number?: string | null; customer_name?: string | null }) => {
      const userName = item.cancelled_by_user_name && item.cancelled_by_user_name !== 'Tidak diketahui' ? item.cancelled_by_user_name : null;
      const waiterName = item.cancelled_by_waiter_name && item.cancelled_by_waiter_name !== 'Tidak diketahui' ? item.cancelled_by_waiter_name : null;
      const cancelledByDisplay = userName && waiterName && waiterName !== userName
        ? `${userName} / Waiters ${waiterName}`
        : userName
          ? userName
          : waiterName
            ? `Waiters ${waiterName}`
            : '-';
      const cancelledTime = item.cancelled_at ? formatDateTime(item.cancelled_at) : '-';
      const priceStr = formatIntegerId(Math.round(Number(item.total_price || 0)));
      const receipt = (item.receipt_number || '-').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const customer = (item.customer_name || 'Guest').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const productName = (item.product_name || '-').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const cancelledBy = cancelledByDisplay.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<tr><td style="font-size: 7pt;">${cancelledTime}</td><td style="font-size: 7pt;">${productName}</td><td class="right" style="font-size: 7pt;">${item.quantity}x</td><td class="right" style="font-size: 7pt;">${priceStr}</td><td style="font-size: 7pt;">#${receipt}</td><td style="font-size: 7pt;">${customer}</td><td style="font-size: 7pt;">${cancelledBy}</td></tr>`;
    }).join('');

    return `
    <div class="report-block">
      <div class="header">
        <div class="title">${sectionTitle}</div>
        <div class="business-name">${businessName}</div>
      </div>

      <div class="divider"></div>

      <div class="info-line">
        <span class="info-label">Cashier:</span>
        <span class="info-value">${report.user_name}</span>
      </div>
      <div class="info-line">
        <span class="info-label">Shift Start:</span>
        <span class="info-value">${shiftStartTime}</span>
      </div>
      <div class="info-line">
        <span class="info-label">Shift End:</span>
        <span class="info-value">${shiftEndTime}</span>
      </div>
      <div class="info-line">
        <span class="info-label">Modal Awal:</span>
        <span class="info-value">${formatIntegerId(Number(report.modal_awal))}</span>
      </div>

      <div class="divider"></div>

      ${sectionOptions.ringkasan === true ? `
      <div class="section-title">RINGKASAN</div>
      <div class="summary">
        <div class="summary-subtitle">Transaksi</div>
        <div class="summary-block-omset">
          <div class="summary-line summary-line-highlight">
            <span class="summary-label">Total Omset (sebelum refund & diskon):</span>
            <span class="summary-value">${formatIntegerId(grossTotalOmset || 0)}</span>
          </div>
          <div class="summary-line summary-line-indent" style="color: #991b1b;">
            <span class="summary-label">Refund:</span>
            <span class="summary-value">-${formatIntegerId(totalRefundsForGrandTotal)}</span>
          </div>
          ${totalCancelledItemsAmount > 0 ? `
          <div class="summary-line summary-line-indent" style="color: #991b1b;">
            <span class="summary-label">Item Dibatalkan:</span>
            <span class="summary-value">-${formatIntegerId(Math.round(totalCancelledItemsAmount))}</span>
          </div>
          ` : ''}
          <div class="summary-block-voucher">
            <div class="summary-line summary-line-highlight-voucher">
              <span class="summary-label">Diskon Voucher:</span>
              <span class="summary-value">${formattedTotalDiscount}</span>
            </div>
            ${((): string => {
          const vb = report.voucherBreakdown || {};
          return VOUCHER_BREAKDOWN_ORDER.map(({ key, label }) => {
            const e = vb[key];
            if (!e || e.count <= 0) return '';
            return `<div class="summary-line summary-line-indent">
                  <span class="summary-label">${label} (${e.count}):</span>
                  <span class="summary-value">-${formatIntegerId(e.total || 0)}</span>
                </div>`;
          }).join('');
        })()}
          </div>
          <div class="summary-line summary-line-highlight">
            <span class="summary-label">Grand Total:</span>
            <span class="summary-value">${formatIntegerId(Math.max(0, (grossTotalOmset || 0) - totalRefundsForGrandTotal - totalCancelledItemsAmount - effectiveTotalDiscount))}</span>
          </div>
        </div>
        ${totalCustomizationRevenue > 0 ? `
        <div class="summary-line summary-line-highlight-topping">
          <span class="summary-label">Total Topping:</span>
          <span class="summary-value">${formatIntegerId(totalCustomizationRevenue)}</span>
        </div>
        ` : ''}
        <div class="summary-subtitle">Kas</div>
        <div class="summary-line">
          <span class="summary-label">Kas Mulai:</span>
          <span class="summary-value">${formatIntegerId(kasMulaiSummary)}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Cash Sales:</span>
          <span class="summary-value">${formatIntegerId(cashShiftSales)}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Total Refunds:</span>
          <span class="summary-value">-${formatIntegerId(cashShiftRefunds)}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Kas Diharapkan:</span>
          <span class="summary-value">${!isNaN(kasExpectedSummary) ? formatIntegerId(kasExpectedSummary) : '-'}</span>
        </div>
        <div class="divider"></div>
        <div class="summary-line">
          <span class="summary-label">Jumlah Pesanan:</span>
          <span class="summary-value">${report.statistics.order_count} transaksi</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Jumlah CU:</span>
          <span class="summary-value">${report.statistics.total_cu ?? 0}</span>
        </div>
      </div>

      <div class="divider"></div>
      ` : ''}

      ${sectionOptions.itemDibatalkan !== false && cancelledItemsList.length > 0 ? `
      <div class="section-title">ITEM DIBATALKAN</div>
      <table>
        <thead>
          <tr>
            <th style="font-size: 7pt;">Waktu Pembatalan</th>
            <th style="font-size: 7pt;">Item</th>
            <th class="right" style="font-size: 7pt;">Jumlah</th>
            <th class="right" style="font-size: 7pt;">Harga</th>
            <th style="font-size: 7pt;">Transaksi</th>
            <th style="font-size: 7pt;">Pelanggan</th>
            <th style="font-size: 7pt;">Dibatalkan Oleh</th>
          </tr>
        </thead>
        <tbody>
          ${cancelledItemsRows}
          <tr class="total-row">
            <td style="font-size: 7pt;">TOTAL</td>
            <td></td>
            <td class="right" style="font-size: 7pt;">${cancelledItemsList.reduce((s: number, i: { quantity?: number }) => s + Number(i.quantity || 0), 0)}x</td>
            <td class="right" style="font-size: 7pt;">${formatIntegerId(Math.round(totalCancelledItemsAmount))}</td>
            <td colspan="3"></td>
          </tr>
        </tbody>
      </table>

      <div class="divider"></div>
      ` : ''}

      ${sectionOptions.paymentMethod === true ? `
      <div class="section-title">PAYMENT METHOD</div>
      <table>
        <thead>
          <tr>
            <th>Payment Method</th>
            <th style="text-align: left;">Count</th>
            <th class="right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${paymentRows || '<tr><td colSpan="3" style="text-align: center;">Tidak ada transaksi</td></tr>'}
          <tr class="total-row">
            <td>TOTAL</td>
            <td style="text-align: left;">${totalPaymentCount}</td>
            <td class="right">${formatIntegerId(Math.round(totalPaymentAmount))}</td>
          </tr>
        </tbody>
      </table>

      <div class="divider"></div>
      ` : ''}

      ${sectionOptions.categoryI === true ? `
      <div class="section-title">CATEGORY I</div>
      <table>
        <thead>
          <tr>
            <th>Category I</th>
            <th style="text-align: left;">Quantity</th>
            <th class="right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${category1Rows || '<tr><td colSpan="3" style="text-align: center;">Tidak ada Category I</td></tr>'}
          <tr class="total-row">
            <td>TOTAL</td>
            <td style="text-align: left;">${totalCategory1Quantity}</td>
            <td class="right">${formatIntegerId(Math.round(totalCategory1Amount))}</td>
          </tr>
        </tbody>
      </table>

      <div class="divider"></div>
      ` : ''}

      ${sectionOptions.categoryII === true ? `
      <div class="section-title">CATEGORY II</div>
      <table>
        <thead>
          <tr>
            <th>Category II</th>
            <th style="text-align: left;">Quantity</th>
            <th class="right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${category2Rows || '<tr><td colSpan="3" style="text-align: center;">Tidak ada Category II</td></tr>'}
          <tr class="total-row">
            <td>TOTAL</td>
            <td style="text-align: left;">${totalCategory2Quantity}</td>
            <td class="right">${formatIntegerId(Math.round(totalCategory2Amount))}</td>
          </tr>
        </tbody>
      </table>

      <div class="divider"></div>
      ` : ''}

      ${sectionOptions.paket === true ? `
      <div class="section-title">PAKET</div>
      <table>
        <thead>
          <tr>
            <th>Paket</th>
            <th style="text-align: left;">Qty</th>
            <th class="right">Unit Price</th>
            <th class="right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${packageRows || '<tr><td colSpan="4" style="text-align: center;">Tidak ada paket terjual</td></tr>'}
          <tr class="total-row">
            <td>TOTAL</td>
            <td style="text-align: left;">${totalPackageQty}</td>
            <td class="right">-</td>
            <td class="right">${formatIntegerId(Math.round(totalPackageAmount))}</td>
          </tr>
        </tbody>
      </table>

      <div class="divider"></div>
      ` : ''}

      ${sectionOptions.barangTerjual === true ? `
      <div class="section-title">BARANG TERJUAL</div>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th style="text-align: left;">Qty</th>
            <th style="text-align: left; font-size: 6pt;">Unit Price</th>
            <th class="right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${productRows || '<tr><td colSpan="4" style="text-align: center;">Tidak ada produk</td></tr>'}
          <tr class="total-row">
            <td>TOTAL</td>
            <td style="text-align: left;">${totalProductQty}</td>
            <td style="text-align: left; font-size: 6pt;">-</td>
            <td class="right">${formatIntegerId(Math.round(totalProductBaseSubtotal))}</td>
          </tr>
          ${productPlatformBreakdownRows}
        </tbody>
      </table>

      <div class="divider"></div>
      ` : ''}

      ${sectionOptions.toppingSales === true && totalCustomizationRevenue > 0 ? `
      <div class="section-title">TOPPING SALES BREAKDOWN</div>
      <table>
        <thead>
          <tr>
            <th>Customization</th>
            <th style="text-align: left;">Qty</th>
            <th class="right">Revenue</th>
          </tr>
        </thead>
        <tbody>
          ${customizationRows || '<tr><td colSpan="3" style="text-align: center;">Tidak ada kustomisasi</td></tr>'}
          <tr class="total-row">
            <td>TOTAL</td>
            <td style="text-align: left;">${totalCustomizationUnits}</td>
            <td class="right">${formatIntegerId(Math.round(totalCustomizationRevenue))}</td>
          </tr>
        </tbody>
      </table>

      <div class="divider"></div>
      ` : ''}

      ${refundList.length > 0 ? `
      <div class="section-title">REFUND</div>
      <table>
        <thead>
          <tr>
            <th style="font-size: 7pt;">Transaction ID</th>
            <th style="font-size: 7pt;">Method</th>
            <th class="right" style="font-size: 7pt;">Total</th>
            <th class="right" style="font-size: 7pt;">Refund Amount</th>
            <th style="font-size: 7pt;">Alasan</th>
            <th style="font-size: 7pt;">Refund Time</th>
            <th style="font-size: 7pt;">Issuer</th>
            <th style="font-size: 7pt;">Waiter</th>
            <th style="font-size: 7pt;">Nama Pelanggan</th>
          </tr>
        </thead>
        <tbody>
          ${refundRows}
        </tbody>
      </table>

      <div class="divider"></div>
      ` : ''}
    </div>
    `;
  };

  const sections: string[] = [];
  const defaultSectionOptions = {
    ringkasan: true,
    barangTerjual: true,
    paymentMethod: true,
    categoryI: true,
    categoryII: true,
    paket: true,
    toppingSales: true,
    itemDibatalkan: true
  };
  const shiftSectionOpts = shiftData.sectionOptions as { ringkasan?: boolean; barangTerjual?: boolean; paymentMethod?: boolean; categoryI?: boolean; categoryII?: boolean; paket?: boolean; toppingSales?: boolean; itemDibatalkan?: boolean } | undefined;
  // Respect false values - only use defaults if sectionOptions is not provided at all
  const sectionOptions = shiftSectionOpts ? {
    ringkasan: shiftSectionOpts.ringkasan !== undefined ? shiftSectionOpts.ringkasan : defaultSectionOptions.ringkasan,
    barangTerjual: shiftSectionOpts.barangTerjual !== undefined ? shiftSectionOpts.barangTerjual : defaultSectionOptions.barangTerjual,
    paymentMethod: shiftSectionOpts.paymentMethod !== undefined ? shiftSectionOpts.paymentMethod : defaultSectionOptions.paymentMethod,
    categoryI: shiftSectionOpts.categoryI !== undefined ? shiftSectionOpts.categoryI : defaultSectionOptions.categoryI,
    categoryII: shiftSectionOpts.categoryII !== undefined ? shiftSectionOpts.categoryII : defaultSectionOptions.categoryII,
    paket: shiftSectionOpts.paket !== undefined ? shiftSectionOpts.paket : defaultSectionOptions.paket,
    toppingSales: shiftSectionOpts.toppingSales !== undefined ? shiftSectionOpts.toppingSales : defaultSectionOptions.toppingSales,
    itemDibatalkan: shiftSectionOpts.itemDibatalkan !== undefined ? shiftSectionOpts.itemDibatalkan : defaultSectionOptions.itemDibatalkan
  } : defaultSectionOptions;

  // Debug logging
  writeDebugLog(JSON.stringify({
    location: 'electron/main.ts:8839',
    message: 'GENERATE HTML - Section options',
    data: sectionOptions,
    timestamp: Date.now(),
    sessionId: 'debug-session',
    runId: 'post-fix',
    hypothesisId: 'B'
  }));
  console.log('🔍 [GENERATE HTML] Section options:', JSON.stringify(sectionOptions));

  sections.push(
    renderReportSection(shiftData, {
      titleOverride: shiftData.title || 'LAPORAN SHIFT',
      businessName: shiftData.businessName,
      sectionOptions: sectionOptions
    })
  );
  if (shiftData.wholeDayReport) {
    sections.push(
      renderReportSection(shiftData.wholeDayReport, {
        titleOverride: shiftData.wholeDayReport.title || 'RINGKASAN HARIAN',
        businessName: shiftData.businessName,
        sectionOptions: sectionOptions
      })
    );
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      width: 42ch;
      max-width: 42ch;
      font-size: 9pt;
      font-weight: 500;
      line-height: 1.2;
      padding: 2mm 7mm;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .report-block + .report-block {
      margin-top: 3mm;
      padding-top: 3mm;
      border-top: 1px dashed #000;
    }
    .header {
      text-align: center;
      margin-bottom: 2mm;
    }
    .title {
      font-size: 11pt;
      font-weight: 700;
      margin-bottom: 0.5mm;
    }
    .business-name {
      font-size: 10pt;
      font-weight: 600;
      margin-bottom: 0mm;
    }
    .divider {
      border-top: 1px dashed #000;
      margin: 1.5mm 0;
    }
    .info-line {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.5mm;
      font-size: 8pt;
    }
    .info-label {
      font-weight: 500;
    }
    .info-value {
      font-weight: 700;
    }
    .section-title {
      font-size: 9pt;
      font-weight: 700;
      margin: 1.5mm 0 1mm 0;
      text-align: center;
      text-decoration: underline;
    }
    .summary-subtitle {
      font-size: 8pt;
      font-weight: 700;
      color: #374151;
      margin: 1mm 0 0.5mm 0;
      padding-bottom: 0.5mm;
      border-bottom: 1px solid #9ca3af;
    }
    .barang-terjual-note {
      font-size: 7pt;
      color: #6b7280;
      margin-bottom: 1mm;
      font-style: italic;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1mm 0;
      font-size: 8pt;
    }
    th {
      text-align: left;
      font-weight: 700;
      border-bottom: 1px solid #000;
      padding: 0.5mm 0;
      font-size: 8pt;
    }
    th.right, td.right {
      text-align: right;
    }
    td {
      padding: 0.5mm 0;
      font-weight: 500;
    }
    .total-row {
      border-top: 2px solid #000;
      font-weight: 700;
      background-color: #f0f0f0;
    }
    .summary {
      margin-top: 1.5mm;
      font-size: 8pt;
    }
    .summary-line {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.5mm;
    }
    .summary-label {
      font-weight: 500;
    }
    .summary-value {
      font-weight: 700;
    }
    .summary-line-highlight {
      font-weight: 700;
      font-size: 9pt;
      background: #fef3c7;
      padding: 1.2mm 1mm;
      margin: 0 0 1mm 0;
      border: 1px solid #fcd34d;
    }
    .summary-line-highlight .summary-value {
      font-weight: 800;
    }
    .summary-line-highlight-voucher {
      font-weight: 700;
      font-size: 9pt;
      background: #dcfce7;
      padding: 1.2mm 1mm;
      margin: 0 0 1mm 0;
      border: 1px solid #86efac;
    }
    .summary-line-highlight-voucher .summary-value {
      font-weight: 800;
    }
    .summary-line-highlight-topping {
      font-weight: 700;
      font-size: 9pt;
      background: #dbeafe;
      padding: 1.2mm 1mm;
      margin: 0 0 1mm 0;
      border: 1px solid #93c5fd;
    }
    .summary-line-highlight-topping .summary-value {
      font-weight: 800;
    }
    .summary-block-omset {
      background: #fef3c7;
      border: 1px solid #fcd34d;
      padding: 1.5mm;
      margin: 0 0 2mm 0;
    }
    .summary-block-voucher {
      background: #dcfce7;
      border: 1px solid #86efac;
      padding: 1.5mm;
      margin: 0 0 2mm 0;
    }
    .summary-line-indent {
      padding-left: 3mm;
    }
    /* Prevent table headers from repeating on every page */
    @media print {
      thead {
        display: table-row-group;
      }
    }
  </style>
</head>
<body>
  ${sections.join('')}

  <div class="divider"></div>

  <div class="info-line" style="margin-top: 1mm;">
    <span class="info-label">Waktu Print:</span>
    <span class="info-value">${printTime}</span>
  </div>
</body>
</html>
  `;
}

type PrintableCashSummary = {
  cash_shift: number;
  cash_shift_sales?: number;
  cash_shift_refunds?: number;
  cash_whole_day: number;
  cash_whole_day_sales?: number;
  cash_whole_day_refunds?: number;
  total_cash_in_cashier: number;
  kas_mulai?: number;
  kas_expected?: number;
  kas_akhir?: number | null;
  kas_selisih?: number | null;
  kas_selisih_label?: 'balanced' | 'plus' | 'minus' | null;
};

type VoucherBreakdown = Record<string, { count: number; total: number }>;

type PrintableShiftRefundRow = {
  refund_uuid?: string;
  transaction_uuid?: string;
  transaction_uuid_id?: string;
  refund_amount?: number;
  refunded_at?: string;
  payment_method?: string;
  final_amount?: number;
  reason?: string | null;
  issuer_email?: string | null;
  waiter_name?: string | null;
  customer_name?: string | null;
};

type PrintableShiftReportSection = {
  title?: string;
  user_name: string;
  shift_start: string;
  shift_end: string | null;
  modal_awal: number;
  statistics: { order_count: number; total_amount: number; total_discount: number; voucher_count: number; total_cu?: number };
  gross_total_omset?: number;
  refunds?: PrintableShiftRefundRow[];
  cancelledItems?: Array<{ product_name: string; quantity: number; total_price: number; cancelled_at: string; cancelled_by_user_name: string; cancelled_by_waiter_name: string; receipt_number?: string | null; customer_name?: string | null }>;
  productSales: Array<{
    product_name: string;
    total_quantity: number;
    total_subtotal: number;
    customization_subtotal: number;
    base_subtotal: number;
    base_unit_price: number;
    platform: string;
    transaction_type: string;
    is_bundle_item?: boolean;
  }>;
  packageSalesBreakdown?: Array<{
    package_product_id: number;
    package_product_name: string;
    total_quantity: number;
    total_amount: number;
    base_unit_price: number;
    lines: Array<{ product_id: number; product_name: string; total_quantity: number }>;
  }>;
  customizationSales: Array<{
    option_id: number;
    option_name: string;
    customization_id: number;
    customization_name: string;
    total_quantity: number;
    total_revenue: number;
  }>;
  paymentBreakdown: Array<{ payment_method_name: string; transaction_count: number; total_amount: number }>;
  category1Breakdown?: Array<{ category1_name: string; category1_id: number; total_quantity: number; total_amount: number }>;
  category2Breakdown?: Array<{ category2_name: string; category2_id: number; total_quantity: number; total_amount: number }>;
  voucherBreakdown?: VoucherBreakdown;
  cashSummary: PrintableCashSummary;
};

const VOUCHER_BREAKDOWN_ORDER: { key: string; label: string }[] = [
  { key: 'percent_10', label: '10%' },
  { key: 'percent_15', label: '15%' },
  { key: 'percent_20', label: '20%' },
  { key: 'percent_25', label: '25%' },
  { key: 'percent_30', label: '30%' },
  { key: 'percent_35', label: '35%' },
  { key: 'percent_50', label: '50%' },
  { key: 'custom', label: 'Custom Nominal' },
  { key: 'free', label: 'Free' }
];

// Print shift breakdown report
ipcMain.handle('print-shift-breakdown', async (event, data: PrintableShiftReportSection & { business_id?: number; printerType?: string; wholeDayReport?: PrintableShiftReportSection | null; sectionOptions?: { ringkasan?: boolean; barangTerjual?: boolean; paymentMethod?: boolean; categoryI?: boolean; categoryII?: boolean; paket?: boolean; toppingSales?: boolean; itemDibatalkan?: boolean } }) => {
  try {
    // #region agent log
    writeDebugLog(JSON.stringify({ location: 'electron/main.ts:print-shift-breakdown', message: 'Received print payload', data: { gross_total_omset: data.gross_total_omset, statistics_total_amount: data.statistics?.total_amount, user_name: data.user_name }, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'B' }));
    // #endregion
    console.log('🖨️ [SHIFT PRINT] Starting shift breakdown print...');
    console.log('   - Shift:', data.user_name);
    console.log('   - Products:', data.productSales?.length || 0);
    console.log('   - Customizations:', data.customizationSales?.length || 0);
    console.log('   - Payments:', data.paymentBreakdown?.length || 0);
    console.log('   - Orders:', data.statistics?.order_count || 0);
    console.log('   - Printer Type:', data.printerType);

    let printerName: string | null = null;
    const printerType = data.printerType || 'receiptPrinter';

    console.log('🔍 [SHIFT PRINT] Looking up printer config for type:', printerType);

    // Get printer name from config
    try {
      // First, list ALL printer configs for debugging
      const allConfigs = await executeQuery<PrinterConfigRow>('SELECT * FROM printer_configs');
      console.log('📋 [SHIFT PRINT] All printer configs in database:');
      allConfigs.forEach((cfg: PrinterConfigRow) => {
        console.log(`   - Type: ${cfg.printer_type}, Name: "${cfg.system_printer_name}"`);
      });

      const config = await executeQueryOne<PrinterConfigRow>(
        'SELECT * FROM printer_configs WHERE printer_type = ?',
        [printerType]
      );
      console.log('📋 [SHIFT PRINT] Printer config query result:', config ? JSON.stringify(config) : 'null');

      if (config && config.system_printer_name) {
        printerName = config.system_printer_name.trim();
        console.log('✅ [SHIFT PRINT] Found printer config:', printerName);

        // Validate printer name is not empty after trim
        if (!printerName || printerName.length === 0) {
          console.error('❌ [SHIFT PRINT] Printer name is empty after trim');
          return {
            success: false,
            error: 'Printer name is empty. Please reconfigure your printer in Settings → Printer Selector.'
          };
        }
      } else {
        console.error('❌ [SHIFT PRINT] No printer config found or system_printer_name is null');
        console.log('   - Config exists:', !!config);
        console.log('   - system_printer_name:', config?.system_printer_name);
        return {
          success: false,
          error: `Receipt Printer not configured. Please configure it in Settings → Printer Selector.`
        };
      }
    } catch (error) {
      console.error('❌ [SHIFT PRINT] Error fetching printer config:', error);
      return { success: false, error: 'Failed to fetch printer configuration' };
    }

    // Double-check printer name is valid before proceeding
    if (!printerName || typeof printerName !== 'string' || printerName.trim().length === 0) {
      console.error('❌ [SHIFT PRINT] Invalid printer name:', printerName);
      return {
        success: false,
        error: 'Invalid printer name. Please reconfigure your printer in Settings → Printer Selector.'
      };
    }

    console.log('🖨️ [SHIFT PRINT] Final deviceName to be used:', printerName);

    // Verify printer exists in system
    try {
      const printers = await mainWindow?.webContents.getPrintersAsync() || [];
      console.log('🖨️ [SHIFT PRINT] Available system printers:', printers.map(p => p.name));

      const printerExists = printers.some(p => p.name === printerName);
      if (!printerExists) {
        console.error('❌ [SHIFT PRINT] Printer not found in system!');
        console.error(`   - Looking for: "${printerName}"`);
        console.error(`   - Available: ${printers.map(p => `"${p.name}"`).join(', ')}`);

        const suggestion = printers.length > 0
          ? `\n\nAvailable printers:\n${printers.map(p => `  - ${p.name}`).join('\n')}\n\nPlease select one of these in Settings → Printer Selector.`
          : '\n\nNo printers detected in Windows. Please check Windows printer settings.';

        return {
          success: false,
          error: `Printer "${printerName}" not found.${suggestion}`
        };
      }

      console.log('✅ [SHIFT PRINT] Printer verified in system');
    } catch (printerCheckError) {
      console.warn('⚠️ [SHIFT PRINT] Could not verify printer list:', printerCheckError);
      // Continue anyway - the print attempt will fail with proper error if needed
    }

    // Fetch business name
    let businessName = 'Momoyo Bakery Kalimantan';
    if (data.business_id) {
      try {
        const business = await executeQueryOne<{ name: string }>(
          'SELECT name FROM businesses WHERE id = ?',
          [data.business_id]
        );
        if (business) {
          businessName = business.name;
        }
      } catch (error) {
        console.error('Error fetching business name:', error);
      }
    }

    // Validate data before HTML generation
    console.log('🔍 [SHIFT PRINT] Validating data...');
    try {
      // Log data structure for debugging
      console.log('   - productSales count:', data.productSales?.length || 0);
      console.log('   - customizationSales count:', data.customizationSales?.length || 0);
      console.log('   - paymentBreakdown count:', data.paymentBreakdown?.length || 0);
      console.log('   - cashSummary:', JSON.stringify(data.cashSummary));

      // Check for problematic data
      if (data.productSales) {
        const invalidProducts = data.productSales.filter((p: any) =>
          !p.product_name ||
          typeof p.total_quantity !== 'number' ||
          isNaN(p.total_quantity)
        );
        if (invalidProducts.length > 0) {
          console.error('❌ [SHIFT PRINT] Found invalid products:', invalidProducts);
        }
      }

      if (data.customizationSales) {
        const invalidCustomizations = data.customizationSales.filter((c: any) =>
          !c.option_name ||
          typeof c.total_quantity !== 'number' ||
          isNaN(c.total_quantity)
        );
        if (invalidCustomizations.length > 0) {
          console.error('❌ [SHIFT PRINT] Found invalid customizations:', invalidCustomizations);
        }
      }

      // Check cash summary for NaN values
      if (data.cashSummary) {
        const cashKeys = Object.keys(data.cashSummary);
        for (const key of cashKeys) {
          const value = (data.cashSummary as any)[key];
          if (typeof value === 'number' && isNaN(value)) {
            console.error(`❌ [SHIFT PRINT] NaN detected in cashSummary.${key}`);
          }
        }
      }

      console.log('✅ [SHIFT PRINT] Data validation passed');
    } catch (validationError) {
      console.error('❌ [SHIFT PRINT] Data validation error:', validationError);
    }

    // Generate HTML with error handling
    let htmlContent: string;
    try {
      console.log('🎨 [SHIFT PRINT] Generating HTML...');
      // Debug logging
      writeDebugLog(JSON.stringify({
        location: 'electron/main.ts:9191',
        message: 'PRINT HANDLER - Received sectionOptions',
        data: data.sectionOptions,
        timestamp: Date.now(),
        sessionId: 'debug-session',
        runId: 'post-fix',
        hypothesisId: 'A'
      }));
      console.log('🔍 [PRINT HANDLER] Received sectionOptions:', JSON.stringify(data.sectionOptions));

      htmlContent = generateShiftBreakdownHTML({
        ...data,
        productSales: data.productSales || [],
        customizationSales: data.customizationSales || [],
        paymentBreakdown: data.paymentBreakdown || [],
        category1Breakdown: data.category1Breakdown || [],
        category2Breakdown: data.category2Breakdown || [],
        cashSummary: data.cashSummary,
        wholeDayReport: data.wholeDayReport || null,
        businessName,
        sectionOptions: data.sectionOptions
      });
      console.log('✅ [SHIFT PRINT] HTML generation successful');
    } catch (htmlError) {
      console.error('❌ [SHIFT PRINT] HTML generation failed:', htmlError);
      console.error('   Error stack:', (htmlError as Error).stack);
      return {
        success: false,
        error: `HTML generation failed: ${String(htmlError)}`
      };
    }

    const htmlSizeKB = (htmlContent.length / 1024).toFixed(2);
    console.log(`📄 [SHIFT PRINT] Generated HTML size: ${htmlSizeKB} KB (${htmlContent.length} chars)`);

    if (htmlContent.length > 500000) {  // > 500KB
      console.warn(`⚠️ [SHIFT PRINT] Large print job detected! This may cause printing issues.`);
    }

    // Close existing print window if any
    if (printWindow) {
      console.log('🗑️ [SHIFT PRINT] Closing existing print window');
      printWindow.close();
    }

    // Create new print window
    console.log('🪟 [SHIFT PRINT] Creating print window');
    try {
      printWindow = new BrowserWindow({
        width: 400,
        height: 600,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        }
      });
    } catch (windowError) {
      console.error('❌ [SHIFT PRINT] Failed to create print window:', windowError);
      return { success: false, error: `Failed to create print window: ${String(windowError)}` };
    }

    console.log('📝 [SHIFT PRINT] Loading HTML into print window...');
    try {
      await printWindow.loadURL(`data:text/html,${encodeURIComponent(htmlContent)}`);
      console.log('✅ [SHIFT PRINT] HTML loaded successfully');
    } catch (loadError) {
      console.error('❌ [SHIFT PRINT] Failed to load HTML:', loadError);
      if (printWindow && !printWindow.isDestroyed()) {
        printWindow.close();
        printWindow = null;
      }
      return { success: false, error: `Failed to load HTML: ${String(loadError)}` };
    }

    // Use callback-based print to properly wait for completion and catch errors
    return new Promise((resolve) => {
      const currentWindow = printWindow;
      setTimeout(async () => {
        try {
          if (!currentWindow || currentWindow.isDestroyed()) {
            console.error('❌ [SHIFT PRINT] Print window not available');
            resolve({ success: false, error: 'Print window unavailable' });
            return;
          }
          const deviceName = await resolvePrintDeviceName(currentWindow.webContents, printerName);
          const printOptions: { silent: boolean; printBackground: boolean; deviceName?: string } = {
            silent: true,
            printBackground: false,
            ...(deviceName ? { deviceName } : {}),
          };
          console.log('🖨️ [SHIFT PRINT] Print options:', JSON.stringify(printOptions, null, 2));

          currentWindow.webContents.print(printOptions, (success: boolean, errorType: string) => {
            if (success) {
              console.log('✅ [SHIFT PRINT] Shift breakdown printed successfully');
              resolve({ success: true });
            } else {
              console.error('❌ [SHIFT PRINT] Print failed:', errorType);
              console.error('   - deviceName used:', printerName);

              let userFriendlyError = errorType || 'Print failed';

              // Provide helpful error messages
              if (errorType && errorType.toLowerCase().includes('devicename')) {
                userFriendlyError = `Invalid printer: "${printerName}". Please:\n1. Go to Settings → Printer Selector\n2. Click "Scan Printers"\n3. Select your printer again\n4. Click "Save"\n5. Try printing again`;
              } else if (errorType && errorType.toLowerCase().includes('offline')) {
                userFriendlyError = `Printer "${printerName}" is offline. Please check:\n1. Printer is powered on\n2. Printer is connected\n3. Printer shows "Ready" in Windows settings`;
              }

              resolve({ success: false, error: userFriendlyError });
            }

            // Close window after print completes (success or failure)
            setTimeout(() => {
              if (currentWindow && !currentWindow.isDestroyed()) {
                currentWindow.close();
              }
              if (printWindow === currentWindow) {
                printWindow = null;
              }
            }, 1000);
          });
        } catch (err) {
          console.error('❌ [SHIFT PRINT] Exception during print:', err);
          resolve({ success: false, error: String(err) });
          if (currentWindow && !currentWindow.isDestroyed()) {
            currentWindow.close();
          }
          if (printWindow === currentWindow) {
            printWindow = null;
          }
        }
      }, 500);  // Give window time to fully load before printing
    });
  } catch (error) {
    console.error('❌ [SHIFT PRINT] Error printing shift breakdown:', error);
    return { success: false, error: String(error) };
  }
});

// Print transactions report (Laporan Semua Transaksi) by date range
type TransactionsReportRow = {
  num: number;
  badge: 'R' | 'RR';
  uuid: string;
  waktu: string;
  metode: string;
  diTa: string;
  total: string;
  discVc: string;
  final: string;
  refund: string;
  pelanggan: string;
  waiter: string;
  kasir: string;
};
function generateTransactionsReportHTML(params: {
  businessName: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  transactions: TransactionsReportRow[];
}): string {
  const { businessName, dateRangeStart, dateRangeEnd, transactions } = params;
  const rows = transactions
    .map(
      (r) =>
        `<tr class="b">
          <td class="c">${r.num} ${r.badge}</td>
          <td class="c">${escapeHtml(r.uuid)}</td>
          <td class="c">${escapeHtml(r.waktu)}</td>
          <td class="c">${escapeHtml(r.metode)}</td>
          <td class="c">${escapeHtml(r.diTa)}</td>
          <td class="c">${escapeHtml(r.total)}</td>
          <td class="c">${escapeHtml(r.discVc)}</td>
          <td class="c">${escapeHtml(r.final)}</td>
          <td class="c">${escapeHtml(r.refund)}</td>
          <td class="c">${escapeHtml(r.pelanggan)}</td>
          <td class="c">${escapeHtml(r.waiter)}</td>
          <td class="c">${escapeHtml(r.kasir)}</td>
        </tr>`
    )
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:Consolas,monospace;font-size:10px;margin:8px;}
    h1{font-size:12px;margin:0 0 4px 0;}
    .meta{margin-bottom:8px;}
    table{border-collapse:collapse;width:100%;}
    th,td{border:1px solid #333;padding:2px 4px;text-align:left;}
    th{background:#eee;}
    .b{background:#fff;}
    .c{vertical-align:top;}
  </style></head><body>
  <h1>Laporan Semua Transaksi</h1>
  <div class="meta">${escapeHtml(businessName)} | ${escapeHtml(dateRangeStart)} s/d ${escapeHtml(dateRangeEnd)}</div>
  <table><thead><tr>
    <th>#</th><th>UUID</th><th>Waktu</th><th>Metode</th><th>DI/TA</th><th>Total</th><th>Disc/Vc</th><th>Final</th><th>Refund</th><th>Pelanggan</th><th>Waiter</th><th>Kasir</th>
  </tr></thead><tbody>${rows}</tbody></table>
  </body></html>`;
}
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

ipcMain.handle('print-transactions-report', async (event, data: { businessId: number; businessName: string; dateRangeStart: string; dateRangeEnd: string; transactions: TransactionsReportRow[] }) => {
  try {
    let printerName: string | null = null;
    const printerType = 'receiptPrinter';
    try {
      const config = await executeQueryOne<PrinterConfigRow>('SELECT * FROM printer_configs WHERE printer_type = ?', [printerType]);
      if (config?.system_printer_name?.trim()) {
        printerName = config.system_printer_name.trim();
      }
    } catch (_) {
      return { success: false, error: 'Failed to fetch printer configuration' };
    }
    if (!printerName) {
      return { success: false, error: 'Receipt printer not configured. Please set it in Settings → Printer Selector.' };
    }
    const businessName = data.businessName || 'Business';
    const htmlContent = generateTransactionsReportHTML({
      businessName,
      dateRangeStart: data.dateRangeStart,
      dateRangeEnd: data.dateRangeEnd,
      transactions: data.transactions || [],
    });
    let reportWindow: Electron.BrowserWindow | null = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    await reportWindow.loadURL(`data:text/html,${encodeURIComponent(htmlContent)}`);
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      const win = reportWindow;
      setTimeout(async () => {
        if (!win || win.isDestroyed()) {
          resolve({ success: false, error: 'Print window unavailable' });
          return;
        }
        const deviceName = await resolvePrintDeviceName(win.webContents, printerName);
        const printOptions: { silent: boolean; printBackground: boolean; deviceName?: string } = {
          silent: true,
          printBackground: false,
          ...(deviceName ? { deviceName } : {}),
        };
        win.webContents.print(printOptions, (success: boolean, errorType: string) => {
          if (success) resolve({ success: true });
          else {
            resolve({ success: false, error: errorType || 'Print failed' });
          }
          setTimeout(() => {
            if (win && !win.isDestroyed()) win.close();
            if (reportWindow === win) reportWindow = null;
          }, 500);
        });
      }, 400);
    });
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// List available system printers for the renderer
ipcMain.handle('list-printers', async (event) => {
  try {
    const sender = event?.sender;
    const printers = await sender.getPrintersAsync();
    return { success: true, printers };
  } catch (error: unknown) {
    console.error('Failed to list printers:', error);
    const errorMessage = (error && typeof error === 'object' && 'message' in error)
      ? String((error as { message: unknown }).message)
      : String(error);
    return { success: false, error: errorMessage, printers: [] };
  }
});

ipcMain.handle('open-cash-drawer', async () => {
  // Handle cash drawer opening
  console.log('Opening cash drawer');
  // Implement actual cash drawer logic here
  return { success: true };
});

ipcMain.handle('play-sound', async (event, soundType) => {
  // Handle POS sounds
  console.log('Playing sound:', soundType);
  // Implement actual sound logic here
  return { success: true };
});

// IPC handlers for authentication and window control
ipcMain.handle('close-window', async () => {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    windows[0].close();
  }
  return { success: true };
});

ipcMain.handle('minimize-window', async () => {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    windows[0].minimize();
  }
  return { success: true };
});

ipcMain.handle('maximize-window', async () => {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    if (windows[0].isMaximized()) {
      windows[0].unmaximize();
    } else {
      windows[0].maximize();
    }
  }
  return { success: true };
});

ipcMain.handle('navigate-to', async (event, path) => {
  if (mainWindow) {
    const currentURL = mainWindow.webContents.getURL();
    const baseURL = currentURL.split('/').slice(0, 3).join('/');
    mainWindow.loadURL(`${baseURL}${path}`);
  }
  return { success: true };
});

// IPC handlers for dual-display communication
ipcMain.handle('update-customer-display', async (event, data) => {
  if (customerWindow) {
    customerWindow.webContents.send('order-update', data);
  }
  return { success: true };
});

ipcMain.handle('update-customer-slideshow', async (event, data) => {
  if (customerWindow) {
    customerWindow.webContents.send('slideshow-update', data);
  }
  return { success: true };
});

ipcMain.handle('get-customer-display-status', async () => {
  return {
    hasCustomerDisplay: customerWindow !== null,
    isCustomerDisplayVisible: customerWindow ? !customerWindow.isDestroyed() : false
  };
});

// Debug function to manually create customer display
ipcMain.handle('create-customer-display', async () => {
  if (customerWindow && !customerWindow.isDestroyed()) {
    customerWindow.show();
    return { success: true, message: 'Customer display already exists' };
  }

  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  const secondaryDisplay = displays.find(display => display.id !== primaryDisplay.id);

  if (!secondaryDisplay) {
    return { success: false, message: 'No secondary display detected' };
  }

  const customerWindowWidth = Math.floor(secondaryDisplay.workAreaSize.width * 0.9);
  const customerWindowHeight = Math.floor(secondaryDisplay.workAreaSize.height * 0.9);

  customerWindow = new BrowserWindow({
    width: customerWindowWidth,
    height: customerWindowHeight,
    x: secondaryDisplay.workArea.x,
    y: secondaryDisplay.workArea.y,
    title: 'Pictos - Customer Display',
    frame: false,
    backgroundColor: '#000000',
    alwaysOnTop: true,
    kiosk: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
  });

  // Load customer display page
  if (isDev) {
    // Try ports in order: 3000, 3001, 3002 (3000 is default Next.js port)
    const tryLoadCustomerURL = async (port: number) => {
      try {
        await customerWindow!.loadURL(`http://localhost:${port}/customer-display`);
        customerWindow!.show();
        console.log(`✅ Customer display created and shown on port ${port}`);
        return true;
      } catch (error) {
        console.log(`❌ Failed to load customer display on port ${port}:`, error);
        return false;
      }
    };

    const ports = [3000, 3001, 3002];
    let loaded = false;

    for (const port of ports) {
      if (await tryLoadCustomerURL(port)) {
        loaded = true;
        break;
      }
    }

    if (!loaded) {
      console.error('❌ Failed to load customer display on any port');
    }
  } else {
    customerWindow.loadFile(path.join(__dirname, '../../out/customer-display.html'));
    customerWindow.show();
  }

  return { success: true, message: 'Customer display created successfully' };
});

// Create Barista & Kitchen display window
ipcMain.handle('create-barista-kitchen-window', async () => {
  console.log('🔍 [BARISTA-KITCHEN] Creating window...');

  // If window already exists and is not destroyed, show it
  if (baristaKitchenWindow && !baristaKitchenWindow.isDestroyed()) {
    console.log('🔍 [BARISTA-KITCHEN] Window already exists, showing it...');
    baristaKitchenWindow.show();
    baristaKitchenWindow.focus();
    return { success: true, message: 'Barista & Kitchen window already exists' };
  }

  // Create new window
  const windowWidth = 1920;
  const windowHeight = 1080;

  console.log('🔍 [BARISTA-KITCHEN] Creating new BrowserWindow...');
  baristaKitchenWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    center: true,
    minWidth: 1280,
    minHeight: 720,
    title: 'Pictos - Barista & Kitchen Display',
    frame: false, // No title bar - frameless window
    backgroundColor: '#f3f4f6',
    movable: true,
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      devTools: true,
    },
    show: false,
  });

  console.log('✅ [BARISTA-KITCHEN] BrowserWindow created');

  // Remove menu bar (File, View, Window menus)
  baristaKitchenWindow.setMenuBarVisibility(false);

  // Handle window closed
  baristaKitchenWindow.on('closed', () => {
    console.log('🔍 [BARISTA-KITCHEN] Window closed');
    baristaKitchenWindow = null;
  });

  // Show window when ready
  baristaKitchenWindow.once('ready-to-show', () => {
    console.log('🔍 [BARISTA-KITCHEN] Window ready to show');
    if (baristaKitchenWindow && !baristaKitchenWindow.isDestroyed()) {
      baristaKitchenWindow.show();
      baristaKitchenWindow.focus();
    }
  });

  // Load barista-kitchen display page
  if (isDev) {
    console.log('🔍 [BARISTA-KITCHEN] Dev mode - loading from localhost...');
    // Try ports in order: 3000, 3001, 3002 (3000 is default Next.js port)
    const tryLoadURL = async (port: number) => {
      try {
        const url = `http://localhost:${port}/barista-kitchen-display`;
        console.log(`🔍 [BARISTA-KITCHEN] Trying to load: ${url}`);
        await baristaKitchenWindow!.loadURL(url);
        // Window will be shown via ready-to-show event
        console.log(`✅ Barista & Kitchen window loaded on port ${port}`);
        return true;
      } catch (error) {
        console.log(`❌ Failed to load Barista & Kitchen display on port ${port}:`, error);
        return false;
      }
    };

    const ports = [3000, 3001, 3002];
    let loaded = false;

    for (const port of ports) {
      if (await tryLoadURL(port)) {
        loaded = true;
        // Fallback: ensure window is shown even if ready-to-show already fired
        setTimeout(() => {
          if (baristaKitchenWindow && !baristaKitchenWindow.isDestroyed()) {
            baristaKitchenWindow.show();
            baristaKitchenWindow.focus();
          }
        }, 500);
        break;
      }
    }

    if (!loaded) {
      console.error('❌ Failed to load Barista & Kitchen display on any port');
      return { success: false, error: 'Failed to load display on any port' };
    }
  } else {
    // In production, load from file
    console.log('🔍 [BARISTA-KITCHEN] Production mode - loading from file...');
    try {
      const filePath = path.join(__dirname, '../../out/barista-kitchen-display.html');
      console.log(`🔍 [BARISTA-KITCHEN] Loading file: ${filePath}`);
      await baristaKitchenWindow.loadFile(filePath);
      // Window will be shown via ready-to-show event
      console.log('✅ [BARISTA-KITCHEN] File loaded');
      // Fallback: ensure window is shown
      setTimeout(() => {
        if (baristaKitchenWindow && !baristaKitchenWindow.isDestroyed()) {
          baristaKitchenWindow.show();
          baristaKitchenWindow.focus();
        }
      }, 500);
    } catch (error) {
      console.error('❌ Failed to load Barista & Kitchen display:', error);
      return { success: false, error: String(error) };
    }
  }

  console.log('✅ [BARISTA-KITCHEN] Window creation completed successfully');
  return { success: true, message: 'Barista & Kitchen window created successfully' };
});

// Helper to create a single display window (Kitchen or Barista)
async function createDisplayWindow(
  getWindow: () => BrowserWindow | null,
  setWindow: (w: BrowserWindow | null) => void,
  title: string,
  routePath: string,
  htmlFileName: string
): Promise<{ success: boolean; error?: string }> {
  let win = getWindow();
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return { success: true };
  }
  const windowWidth = 1920;
  const windowHeight = 1080;
  win = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    center: true,
    minWidth: 1280,
    minHeight: 720,
    title: `Pictos - ${title}`,
    frame: false,
    backgroundColor: '#f3f4f6',
    movable: true,
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      devTools: true,
    },
    show: false,
  });
  setWindow(win);
  win.setMenuBarVisibility(false);
  win.on('closed', () => setWindow(null));
  win.once('ready-to-show', () => {
    const w = getWindow();
    if (w && !w.isDestroyed()) {
      w.show();
      w.focus();
    }
  });
  if (isDev) {
    const ports = [3000, 3001, 3002];
    let loaded = false;
    for (const port of ports) {
      try {
        await win.loadURL(`http://localhost:${port}${routePath}`);
        loaded = true;
        setTimeout(() => {
          const w = getWindow();
          if (w && !w.isDestroyed()) {
            w.show();
            w.focus();
          }
        }, 500);
        break;
      } catch {
        // try next port
      }
    }
    if (!loaded) return { success: false, error: `Failed to load ${title} on any port` };
  } else {
    try {
      await win.loadFile(path.join(__dirname, '../../out', htmlFileName));
      setTimeout(() => {
        const w = getWindow();
        if (w && !w.isDestroyed()) {
          w.show();
          w.focus();
        }
      }, 500);
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
  return { success: true };
}

ipcMain.handle('create-kitchen-window', async () => {
  return createDisplayWindow(
    () => kitchenDisplayWindow,
    (w) => { kitchenDisplayWindow = w; },
    'Kitchen Display',
    '/kitchen-display',
    'kitchen-display.html'
  );
});

ipcMain.handle('create-barista-window', async () => {
  return createDisplayWindow(
    () => baristaDisplayWindow,
    (w) => { baristaDisplayWindow = w; },
    'Barista Display',
    '/barista-display',
    'barista-display.html'
  );
});

function getSlideshowPath(): string {
  const userDataPath = app.getPath('userData');
  const slideshowPath = path.join(userDataPath, 'slideshow');

  // Create directory if it doesn't exist
  if (!fs.existsSync(slideshowPath)) {
    fs.mkdirSync(slideshowPath, { recursive: true });
    console.log('📁 Created slideshow directory:', slideshowPath);
  }

  return slideshowPath;
}

// Get all slideshow images from userData
ipcMain.handle('get-slideshow-images', async () => {
  try {
    const slideshowPath = getSlideshowPath();
    const files = fs.readdirSync(slideshowPath);

    // Filter for image files only
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const imageFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return imageExtensions.includes(ext);
    });

    // Sort files alphabetically
    imageFiles.sort();

    // Create image objects with metadata
    const images = imageFiles.map((file, index) => {
      const filePath = path.join(slideshowPath, file);
      const stats = fs.statSync(filePath);

      return {
        id: `slide-${index + 1}`,
        filename: file,
        path: `slideshow-file://${file}`, // Custom protocol
        localPath: filePath, // Full system path
        title: file.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '),
        duration: 5,
        order: index + 1,
        size: stats.size,
        createdAt: stats.birthtime.toISOString()
      };
    });

    console.log(`📸 Found ${images.length} slideshow images in userData`);

    return {
      success: true,
      images,
      count: images.length,
      path: slideshowPath
    };

  } catch (error) {
    console.error('❌ Error reading slideshow images:', error);
    return {
      success: false,
      error: 'Failed to read slideshow images',
      images: [],
      count: 0
    };
  }
});

// Save a new slideshow image to userData
ipcMain.handle('save-slideshow-image', async (event, imageData: { filename: string; buffer: Buffer }) => {
  try {
    const slideshowPath = getSlideshowPath();
    const filePath = path.join(slideshowPath, imageData.filename);

    // Check if file already exists
    if (fs.existsSync(filePath)) {
      return {
        success: false,
        error: 'File already exists. Please rename or delete the existing file first.'
      };
    }

    // Write the file
    fs.writeFileSync(filePath, imageData.buffer);
    console.log('✅ Saved slideshow image:', imageData.filename);

    return {
      success: true,
      message: 'Image saved successfully',
      filename: imageData.filename
    };

  } catch (error) {
    console.error('❌ Error saving slideshow image:', error);
    return {
      success: false,
      error: 'Failed to save image'
    };
  }
});

// Delete a slideshow image from userData
ipcMain.handle('delete-slideshow-image', async (event, filename: string) => {
  try {
    const slideshowPath = getSlideshowPath();
    const filePath = path.join(slideshowPath, filename);

    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        error: 'File not found'
      };
    }

    fs.unlinkSync(filePath);
    console.log('🗑️ Deleted slideshow image:', filename);

    return {
      success: true,
      message: 'Image deleted successfully'
    };

  } catch (error) {
    console.error('❌ Error deleting slideshow image:', error);
    return {
      success: false,
      error: 'Failed to delete image'
    };
  }
});

// Get Shift by UUID
ipcMain.handle('localDbGetShiftByUuid', async (event, shiftUuid: string) => {
  try {
    const shift = await executeQueryOne('SELECT * FROM shifts WHERE uuid_id = ?', [shiftUuid]);
    return shift || null;
  } catch (error) {
    console.error('❌ Error fetching shift by UUID:', error);
    return null;
  }
});

// Get Printer Audits by Transaction ID
ipcMain.handle('localDbGetPrinterAuditsByTransactionId', async (event, transactionId: string) => {
  try {
    const printer1 = await executeQuery('SELECT * FROM printer1_audit_log WHERE transaction_id = ?', [transactionId]);
    const printer2 = await executeQuery('SELECT * FROM printer2_audit_log WHERE transaction_id = ?', [transactionId]);
    return { printer1, printer2 };
  } catch (error) {
    console.error('❌ Error fetching printer audits:', error);
    return { printer1: [], printer2: [] };
  }
});


// ============================================================================
// ADMIN: DELETE TRANSACTIONS BY USER EMAIL OR NULL
// ============================================================================

/**
 * Delete all transactions made by marviano.austin@gmail.com or where user_id is NULL.
 * Deletes from salespulse (main), system_pos, and clears printer daily counters for affected businesses.
 */
ipcMain.handle('localdb-delete-transactions-by-role', async () => {
  const details = {
    database: 'MySQL',
    targetUserIds: [] as number[],
    printer_audit_log: 0,
    printer1_audit_log: 0,
    printer2_audit_log: 0,
    transaction_items: 0,
    transactions: 0,
    shifts: 0,
    system_pos_queue: 0,
    system_pos_transactions: 0,
    counters_reset_businesses: [] as number[],
    success: false,
    error: null as string | null
  };

  try {
    console.log('[CLEANUP] [MySQL] Starting transaction cleanup for marviano.austin@gmail.com and NULL user_id');

    const targetUsers = await executeQuery<{ id: number }>(
      'SELECT id FROM users WHERE email = ?',
      ['marviano.austin@gmail.com']
    );

    const targetUserIds = targetUsers.map(u => u.id);
    details.targetUserIds = targetUserIds;
    console.log(`[CLEANUP] [MySQL] Target user IDs: ${targetUserIds.join(', ')}`);

    let whereClause = 'WHERE user_id IS NULL';
    const params: (string | number | null | boolean)[] = [];

    if (targetUserIds.length > 0) {
      whereClause += ` OR user_id IN (${targetUserIds.map(() => '?').join(',')})`;
      params.push(...targetUserIds);
    }

    const transactionsToDelete = await executeQuery<{ id: number; uuid_id: string; business_id: number }>(
      `SELECT id, uuid_id, business_id FROM transactions ${whereClause}`,
      params
    );

    const transactionIds = transactionsToDelete.map(t => t.id);
    const transactionUuids = transactionsToDelete.map(t => t.uuid_id);
    const distinctBusinessIds = [...new Set(transactionsToDelete.map(t => t.business_id))];
    console.log(`[CLEANUP] [MySQL] Found ${transactionIds.length} transactions to delete`);

    if (transactionIds.length === 0) {
      // Still delete shifts for target user (marviano.austin@gmail.com)
      if (targetUserIds.length > 0) {
        try {
          const shiftsDeleted = await executeUpdate(
            `DELETE FROM shifts WHERE user_id IN (${targetUserIds.map(() => '?').join(',')})`,
            targetUserIds
          );
          details.shifts = shiftsDeleted;
          if (details.shifts > 0) {
            console.log(`[CLEANUP] [MySQL] Deleted ${details.shifts} shifts for target user(s)`);
          }
        } catch (e) {
          console.warn('[CLEANUP] Failed to delete shifts:', e);
        }
      }
      details.success = true;
      console.log(`✅ [CLEANUP] [MySQL] No transactions to delete`);
      return {
        success: true,
        message: 'No transactions found to delete',
        deleted: 0,
        deletedItems: 0,
        details
      };
    }

    const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];
    const placeholders = transactionIds.map(() => '?').join(',');
    const uuidPlaceholders = transactionUuids.map(() => '?').join(',');

    // 1. transaction_item_customization_options
    const customizationIds = await executeQuery<{ id: number }>(`
      SELECT DISTINCT tic.id 
      FROM transaction_item_customizations tic
      JOIN transaction_items ti ON tic.transaction_item_id = ti.id
      WHERE ti.transaction_id IN (${placeholders})
    `, transactionIds);

    if (customizationIds.length > 0) {
      const customizationPlaceholders = customizationIds.map(() => '?').join(',');
      queries.push({
        sql: `DELETE FROM transaction_item_customization_options WHERE transaction_item_customization_id IN (${customizationPlaceholders})`,
        params: customizationIds.map(c => c.id)
      });
    }

    // 2. transaction_item_customizations
    queries.push({
      sql: `DELETE FROM transaction_item_customizations WHERE transaction_item_id IN (SELECT id FROM transaction_items WHERE transaction_id IN (${placeholders}))`,
      params: [...transactionIds]
    });

    // 3. transaction_items
    queries.push({
      sql: `DELETE FROM transaction_items WHERE transaction_id IN (${placeholders})`,
      params: [...transactionIds]
    });

    // 4. transaction_refunds (transaction_uuid)
    queries.push({
      sql: `DELETE FROM transaction_refunds WHERE transaction_uuid IN (${uuidPlaceholders})`,
      params: [...transactionUuids]
    });

    // 5. printer1_audit_log (transaction_id = uuid_id)
    queries.push({
      sql: `DELETE FROM printer1_audit_log WHERE transaction_id IN (${uuidPlaceholders})`,
      params: [...transactionUuids]
    });

    // 6. printer2_audit_log (transaction_id = uuid_id)
    queries.push({
      sql: `DELETE FROM printer2_audit_log WHERE transaction_id IN (${uuidPlaceholders})`,
      params: [...transactionUuids]
    });

    // 6b. offline_refunds: delete orphan refunds for deleted transactions
    queries.push({
      sql: `DELETE FROM offline_refunds WHERE JSON_UNQUOTE(JSON_EXTRACT(refund_data, '$.transaction_uuid')) IN (${uuidPlaceholders})`,
      params: [...transactionUuids]
    });

    // 7. transactions
    queries.push({
      sql: `DELETE FROM transactions ${whereClause}`,
      params: [...params]
    });

    await executeTransaction(queries);

    // ----- shifts: delete shifts owned by target user (marviano.austin@gmail.com) -----
    if (targetUserIds.length > 0) {
      try {
        const shiftsDeleted = await executeUpdate(
          `DELETE FROM shifts WHERE user_id IN (${targetUserIds.map(() => '?').join(',')})`,
          targetUserIds
        );
        details.shifts = shiftsDeleted;
        if (details.shifts > 0) {
          console.log(`[CLEANUP] [MySQL] Deleted ${details.shifts} shifts for target user(s)`);
        }
      } catch (e) {
        console.warn('[CLEANUP] Failed to delete shifts:', e);
      }
    }

    // ----- system_pos -----
    const sysPosQueries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];
    sysPosQueries.push({
      sql: `DELETE FROM system_pos_queue WHERE transaction_id IN (${uuidPlaceholders})`,
      params: [...transactionUuids]
    });
    sysPosQueries.push({
      sql: `DELETE FROM transactions WHERE uuid_id IN (${uuidPlaceholders})`,
      params: [...transactionUuids]
    });
    await executeSystemPosTransaction(sysPosQueries);
    details.system_pos_queue = transactionUuids.length;
    details.system_pos_transactions = transactionUuids.length;
    console.log(`[CLEANUP] [system_pos] Deleted ${transactionUuids.length} queue rows and matching transactions`);

    // ----- Reset printer daily counters for each affected business -----
    for (const bid of distinctBusinessIds) {
      try {
        await executeUpdate(`DELETE FROM printer_daily_counters WHERE business_id = ?`, [bid]);
        details.counters_reset_businesses.push(bid);
      } catch (e) {
        console.warn(`[CLEANUP] Failed to reset printer daily counters for business ${bid}:`, e);
      }
    }
    console.log(`[CLEANUP] Reset printer daily counters for businesses: ${distinctBusinessIds.join(', ')}`);

    details.transaction_items = transactionIds.length;
    details.transactions = transactionIds.length;
    details.success = true;
    console.log(`✅ [CLEANUP] [MySQL + system_pos] Completed; counters reset for ${details.counters_reset_businesses.length} business(es)`);

    return {
      success: true,
      message: 'Transactions deleted successfully',
      deleted: details.transactions,
      deletedItems: details.transaction_items,
      details
    };
  } catch (error: any) {
    details.error = error.message || 'Failed to cleanup transactions';
    console.error(`❌ [CLEANUP] [MySQL] Failed:`, error);
    return {
      success: false,
      deleted: 0,
      deletedItems: 0,
      error: details.error,
      details
    };
  }
});


// Open slideshow folder in file explorer
ipcMain.handle('open-slideshow-folder', async () => {
  try {
    const slideshowPath = getSlideshowPath();
    const { shell } = require('electron');
    await shell.openPath(slideshowPath);

    return {
      success: true,
      message: 'Opened slideshow folder',
      path: slideshowPath
    };

  } catch (error) {
    console.error('❌ Error opening slideshow folder:', error);
    return {
      success: false,
      error: 'Failed to open folder'
    };
  }
});

// Read slideshow image file (for serving to renderer)
ipcMain.handle('read-slideshow-image', async (event, filename: string) => {
  try {
    const slideshowPath = getSlideshowPath();
    const filePath = path.join(slideshowPath, filename);

    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        error: 'File not found'
      };
    }

    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filename).toLowerCase();

    // Determine MIME type
    let mimeType = 'image/jpeg';
    if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.webp') mimeType = 'image/webp';
    else if (ext === '.gif') mimeType = 'image/gif';

    return {
      success: true,
      buffer: buffer,
      mimeType: mimeType,
      filename: filename
    };

  } catch (error) {
    console.error('❌ Error reading slideshow image:', error);
    return {
      success: false,
      error: 'Failed to read image'
    };
  }
});

// Migrate images from /public/images/slideshow/ to userData (one-time migration)
ipcMain.handle('migrate-slideshow-images', async () => {
  try {
    const slideshowPath = getSlideshowPath();
    const publicSlideshowPath = path.join(process.cwd(), 'public', 'images', 'slideshow');

    // Check if public folder exists
    if (!fs.existsSync(publicSlideshowPath)) {
      return {
        success: true,
        message: 'No public slideshow folder found, nothing to migrate',
        migrated: 0
      };
    }

    // Check if userData folder already has images (skip migration if already done)
    const existingFiles = fs.readdirSync(slideshowPath);
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const existingImages = existingFiles.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return imageExtensions.includes(ext);
    });

    if (existingImages.length > 0) {
      console.log('📸 Slideshow images already exist in userData, skipping migration');
      return {
        success: true,
        message: 'Images already exist in userData, skipping migration',
        migrated: 0,
        existing: existingImages.length
      };
    }

    // Read files from public folder
    const publicFiles = fs.readdirSync(publicSlideshowPath);
    const imagesToMigrate = publicFiles.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return imageExtensions.includes(ext);
    });

    if (imagesToMigrate.length === 0) {
      return {
        success: true,
        message: 'No images found in public folder to migrate',
        migrated: 0
      };
    }

    // Copy images to userData
    let migratedCount = 0;
    for (const file of imagesToMigrate) {
      try {
        const sourcePath = path.join(publicSlideshowPath, file);
        const destPath = path.join(slideshowPath, file);

        fs.copyFileSync(sourcePath, destPath);
        migratedCount++;
        console.log('📸 Migrated:', file);
      } catch (error) {
        console.error('❌ Failed to migrate:', file, error);
      }
    }

    console.log(`✅ Successfully migrated ${migratedCount} images to userData`);

    return {
      success: true,
      message: `Migrated ${migratedCount} images to userData`,
      migrated: migratedCount
    };

  } catch (error) {
    console.error('❌ Error migrating slideshow images:', error);
    return {
      success: false,
      error: 'Failed to migrate images'
    };
  }
});

// =====================================================
// RESTORE FROM SERVER - FULL DATABASE RESTORE
// =====================================================

/**
 * Restore full database from server
 * Downloads master data + transactions and restores to local DB
 */
ipcMain.handle('restore-from-server', async (event, options: {
  businessId: number;
  apiUrl: string;
  includeTransactions?: boolean;
}) => {
  const { businessId, apiUrl, includeTransactions = true } = options;
  const stats: Record<string, number> = {};

  try {
    console.log('🔄 [RESTORE] Starting full restore from server...');
    console.log('🔄 [RESTORE] Business ID:', businessId);
    console.log('🔄 [RESTORE] API URL:', apiUrl);

    // Step 1: Download Master Data from /api/sync
    console.log('📥 [RESTORE] Step 1: Downloading master data...');
    const syncUrl = `${apiUrl}/api/sync?business_id=${businessId}`;
    const syncResponse = await fetch(syncUrl);

    if (!syncResponse.ok) {
      throw new Error(`Failed to download master data: ${syncResponse.status} ${syncResponse.statusText}`);
    }

    const syncData = await syncResponse.json() as any;
    const data = syncData.data || {};

    // Download product/business images and rewrite image_url to pos-image:// for offline display
    try {
      const base = (apiUrl || '').replace(/\/$/, '');
      const userData = app.getPath('userData');
      [path.join(userData, 'images', 'products'), path.join(userData, 'images', 'businesses')].forEach(d => { try { fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ } });
      const imagePathRe = /^\/images\/(products|businesses)\/([^/]+\.(webp|png|jpg|jpeg|gif))$/i;
      const tryDownload = async (imageUrl: string): Promise<string> => {
        if (!imageUrl || typeof imageUrl !== 'string') return imageUrl;
        const m = imageUrl.match(imagePathRe);
        if (!m) return imageUrl;
        const [, sub, filename] = m;
        try {
          const res = await fetch(`${base}${imageUrl}`);
          if (!res.ok) return `${base}${imageUrl}`;
          fs.writeFileSync(path.join(userData, 'images', sub, filename), Buffer.from(await res.arrayBuffer()));
          return `pos-image://${imageUrl}`;
        } catch { return `${base}${imageUrl}`; }
      };
      for (const p of Array.isArray(data.products) ? data.products : []) {
        if (p && typeof (p as any).image_url === 'string') { (p as any).image_url = await tryDownload((p as any).image_url); }
      }
      for (const b of Array.isArray(data.businesses) ? data.businesses : []) {
        if (b && typeof (b as any).image_url === 'string') { (b as any).image_url = await tryDownload((b as any).image_url); }
      }
    } catch (imgErr) {
      console.warn('[RESTORE] Image download (non-fatal):', imgErr);
    }

    // Step 2: Restore Master Data (order matters due to foreign keys!)
    console.log('💾 [RESTORE] Step 2: Restoring master data...');

    const allQueries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];

    // 2.1 Businesses
    if (Array.isArray(data.businesses) && data.businesses.length > 0) {
      for (const biz of data.businesses) {
        allQueries.push({
          sql: `
            INSERT INTO businesses (id, name, permission_name, organization_id, management_group_id, image_url, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              name=VALUES(name),
              permission_name=VALUES(permission_name),
              organization_id=VALUES(organization_id),
              management_group_id=VALUES(management_group_id),
              image_url=VALUES(image_url),
              created_at=VALUES(created_at)
          `,
          params: [
            biz.id,
            biz.name,
            biz.permission_name || biz.name || 'business',
            biz.organization_id || null,
            biz.management_group_id || null,
            biz.image_url || null,
            toMySQLTimestamp(biz.created_at || new Date())
          ]
        });
      }
      stats.businesses = data.businesses.length;
      console.log(`✅ [RESTORE] ${data.businesses.length} businesses restored`);
    }

    // 2.2 Users
    if (Array.isArray(data.users) && data.users.length > 0) {
      for (const usr of data.users) {
        allQueries.push({
          sql: `
            INSERT INTO users (id, email, password, name, googleId, createdAt, role_id, organization_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              email=VALUES(email),
              password=VALUES(password),
              name=VALUES(name),
              googleId=VALUES(googleId),
              createdAt=VALUES(createdAt),
              role_id=VALUES(role_id),
              organization_id=VALUES(organization_id)
          `,
          params: [
            usr.id,
            usr.email,
            usr.password || null,
            usr.name,
            usr.googleId || null,
            toMySQLTimestamp(usr.created_at || usr.createdAt || new Date()),
            usr.role_id || null,
            usr.organization_id || null
          ]
        });
      }
      stats.users = data.users.length;
      console.log(`✅ [RESTORE] ${data.users.length} users restored`);
    }

    // 2.3 Categories
    if (Array.isArray(data.category1) && data.category1.length > 0) {
      for (const cat of data.category1) {
        allQueries.push({
          sql: `
            INSERT INTO category1 (id, name, description, display_order, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              name=VALUES(name),
              description=VALUES(description),
              display_order=VALUES(display_order),
              is_active=VALUES(is_active),
              created_at=VALUES(created_at),
              updated_at=VALUES(updated_at)
          `,
          params: [
            cat.id,
            cat.name,
            cat.description || null,
            cat.display_order || 0,
            cat.is_active !== undefined ? cat.is_active : 1,
            toMySQLTimestamp(cat.created_at || new Date()),
            toMySQLTimestamp(Date.now())
          ]
        });
      }
      stats.category1 = data.category1.length;
      console.log(`✅ [RESTORE] ${data.category1.length} category1 restored`);
    }

    if (Array.isArray(data.category2) && data.category2.length > 0) {
      for (const cat of data.category2) {
        allQueries.push({
          sql: `
            INSERT INTO category2 (id, name, description, display_order, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              name=VALUES(name),
              description=VALUES(description),
              display_order=VALUES(display_order),
              is_active=VALUES(is_active),
              created_at=VALUES(created_at),
              updated_at=VALUES(updated_at)
          `,
          params: [
            cat.id ?? null,
            cat.name ?? null,
            cat.description ?? null,
            cat.display_order ?? 0,
            cat.is_active !== undefined ? cat.is_active : 1,
            toMySQLTimestamp(cat.created_at || new Date()),
            toMySQLTimestamp(Date.now())
          ]
        });
      }

      // Store junction table relationships (REQUIRED - no fallback)
      if (Array.isArray(data.category2Businesses) && data.category2Businesses.length > 0) {
        for (const rel of data.category2Businesses) {
          allQueries.push({
            sql: `
              INSERT INTO category2_businesses (category2_id, business_id, created_at)
              VALUES (?, ?, ?)
              ON DUPLICATE KEY UPDATE created_at=VALUES(created_at)
            `,
            params: [rel.category2_id, rel.business_id, toMySQLTimestamp(new Date())]
          });
        }
        console.log(`✅ [RESTORE] ${data.category2Businesses.length} category2-business relationships restored`);
      } else {
        console.warn(`⚠️ [RESTORE] No junction table data provided for category2 - records will not be associated with any business`);
      }
      stats.category2 = data.category2.length;
      console.log(`✅ [RESTORE] ${data.category2.length} category2 restored`);
    }

    // 2.4 Products (matching local schema: nama, harga_jual, kategori, etc.)
    if (Array.isArray(data.products) && data.products.length > 0) {
      for (const prod of data.products) {
        allQueries.push({
          sql: `
            INSERT INTO products (
              id, business_id, menu_code, nama, satuan, kategori, jenis, 
              category2_id, category2_name, keterangan, harga_beli, ppn, 
              harga_jual, harga_khusus, harga_online, harga_qpon, harga_gofood, 
              harga_grabfood, harga_shopeefood, harga_tiktok, fee_kerja, 
              status, created_at, updated_at, has_customization, is_bundle
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              business_id=VALUES(business_id),
              menu_code=VALUES(menu_code),
              nama=VALUES(nama),
              satuan=VALUES(satuan),
              kategori=VALUES(kategori),
              jenis=VALUES(jenis),
              category2_id=VALUES(category2_id),
              category2_name=VALUES(category2_name),
              keterangan=VALUES(keterangan),
              harga_beli=VALUES(harga_beli),
              ppn=VALUES(ppn),
              harga_jual=VALUES(harga_jual),
              harga_khusus=VALUES(harga_khusus),
              harga_online=VALUES(harga_online),
              harga_qpon=VALUES(harga_qpon),
              harga_gofood=VALUES(harga_gofood),
              harga_grabfood=VALUES(harga_grabfood),
              harga_shopeefood=VALUES(harga_shopeefood),
              harga_tiktok=VALUES(harga_tiktok),
              fee_kerja=VALUES(fee_kerja),
              status=VALUES(status),
              created_at=VALUES(created_at),
              updated_at=VALUES(updated_at),
              has_customization=VALUES(has_customization),
              is_bundle=VALUES(is_bundle)
          `,
          params: [
            prod.id,
            prod.business_id || businessId,
            prod.menu_code || prod.code || null,
            prod.nama || prod.name || 'Unknown',
            prod.satuan || 'pcs',
            prod.kategori || prod.category2_name || 'Other',
            prod.jenis || null,
            prod.category2_id || null,
            prod.category2_name || null,
            prod.keterangan || prod.description || null,
            prod.harga_beli || 0,
            prod.ppn || 0,
            prod.harga_jual || prod.price || 0,
            prod.harga_khusus || null,
            prod.harga_online || null,
            prod.harga_qpon || null,
            prod.harga_gofood || null,
            prod.harga_grabfood || null,
            prod.harga_shopeefood || null,
            prod.harga_tiktok || null,
            prod.fee_kerja || null,
            prod.status || 'active',
            toMySQLTimestamp(prod.created_at || new Date()),
            toMySQLTimestamp(Date.now()),
            prod.has_customization || 0,
            prod.is_bundle || 0
          ]
        });
      }
      stats.products = data.products.length;
      console.log(`✅ [RESTORE] ${data.products.length} products restored`);
    }

    // 2.5 Customization Types
    if (Array.isArray(data.customizationTypes) && data.customizationTypes.length > 0) {
      for (const type of data.customizationTypes) {
        allQueries.push({
          sql: `
            INSERT INTO product_customization_types (id, name, selection_mode)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE
              name=VALUES(name),
              selection_mode=VALUES(selection_mode)
          `,
          params: [type.id, type.name, type.selection_mode || 'single']
        });
      }
      stats.customizationTypes = data.customizationTypes.length;
      console.log(`✅ [RESTORE] ${data.customizationTypes.length} customization types restored`);
    }

    // 2.6 Customization Options
    if (Array.isArray(data.customizationOptions) && data.customizationOptions.length > 0) {
      for (const opt of data.customizationOptions) {
        allQueries.push({
          sql: `
            INSERT INTO product_customization_options (id, type_id, name, price_adjustment, display_order)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              type_id=VALUES(type_id),
              name=VALUES(name),
              price_adjustment=VALUES(price_adjustment),
              display_order=VALUES(display_order)
          `,
          params: [
            opt.id,
            opt.type_id,
            opt.name,
            opt.price_adjustment || 0,
            opt.display_order || 0
          ]
        });
      }
      stats.customizationOptions = data.customizationOptions.length;
      console.log(`✅ [RESTORE] ${data.customizationOptions.length} customization options restored`);
    }

    // 2.7 Product Customizations
    if (Array.isArray(data.productCustomizations) && data.productCustomizations.length > 0) {
      for (const pc of data.productCustomizations) {
        allQueries.push({
          sql: `
            INSERT INTO product_customizations (id, product_id, customization_type_id)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE
              product_id=VALUES(product_id),
              customization_type_id=VALUES(customization_type_id)
          `,
          params: [pc.id, pc.product_id, pc.customization_type_id]
        });
      }
      stats.productCustomizations = data.productCustomizations.length;
      console.log(`✅ [RESTORE] ${data.productCustomizations.length} product customizations restored`);
    }

    // 2.8 Bundle Items
    if (Array.isArray(data.bundleItems) && data.bundleItems.length > 0) {
      for (const bundle of data.bundleItems) {
        allQueries.push({
          sql: `
            INSERT INTO bundle_items (id, bundle_product_id, category2_id, required_quantity, display_order)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              bundle_product_id=VALUES(bundle_product_id),
              category2_id=VALUES(category2_id),
              required_quantity=VALUES(required_quantity),
              display_order=VALUES(display_order)
          `,
          params: [
            bundle.id,
            bundle.bundle_product_id,
            bundle.category2_id,
            bundle.required_quantity || 1,
            bundle.display_order || 0
          ]
        });
      }
      stats.bundleItems = data.bundleItems.length;
      console.log(`✅ [RESTORE] ${data.bundleItems.length} bundle items restored`);
    }

    // 2.8a Package Items
    if (Array.isArray(data.packageItems) && data.packageItems.length > 0) {
      for (const pi of data.packageItems) {
        allQueries.push({
          sql: `
            INSERT INTO package_items (id, package_product_id, selection_type, product_id, required_quantity, display_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              package_product_id=VALUES(package_product_id),
              selection_type=VALUES(selection_type),
              product_id=VALUES(product_id),
              required_quantity=VALUES(required_quantity),
              display_order=VALUES(display_order),
              updated_at=VALUES(updated_at)
          `,
          params: [
            pi.id,
            pi.package_product_id,
            pi.selection_type || 'default',
            pi.product_id ?? null,
            pi.required_quantity || 1,
            pi.display_order ?? 0,
            toMySQLTimestamp(pi.created_at || new Date()),
            toMySQLTimestamp(pi.updated_at || Date.now())
          ]
        });
      }
      stats.packageItems = data.packageItems.length;
      console.log(`✅ [RESTORE] ${data.packageItems.length} package items restored`);
    }

    // 2.8b Package Item Products
    if (Array.isArray(data.packageItemProducts) && data.packageItemProducts.length > 0) {
      for (const pip of data.packageItemProducts) {
        allQueries.push({
          sql: `
            INSERT INTO package_item_products (id, package_item_id, product_id, display_order, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              display_order=VALUES(display_order)
          `,
          params: [
            pip.id,
            pip.package_item_id,
            pip.product_id,
            pip.display_order ?? 0,
            toMySQLTimestamp(pip.created_at || new Date())
          ]
        });
      }
      stats.packageItemProducts = data.packageItemProducts.length;
      console.log(`✅ [RESTORE] ${data.packageItemProducts.length} package item products restored`);
    }

    // 2.9 Payment Methods
    if (Array.isArray(data.paymentMethods) && data.paymentMethods.length > 0) {
      for (const pm of data.paymentMethods) {
        allQueries.push({
          sql: `
            INSERT INTO payment_methods (id, name, code, description, is_active, requires_additional_info, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              name=VALUES(name),
              code=VALUES(code),
              description=VALUES(description),
              is_active=VALUES(is_active),
              requires_additional_info=VALUES(requires_additional_info),
              created_at=VALUES(created_at),
              updated_at=VALUES(updated_at)
          `,
          params: [
            pm.id ?? null,
            pm.name ?? null,
            pm.code ?? null,
            pm.description ?? null,
            pm.is_active !== undefined ? pm.is_active : 1,
            pm.requires_additional_info ?? 0,
            toMySQLTimestamp(pm.created_at || new Date()),
            toMySQLTimestamp(Date.now())
          ]
        });
      }
      stats.paymentMethods = data.paymentMethods.length;
      console.log(`✅ [RESTORE] ${data.paymentMethods.length} payment methods restored`);
    }

    // 2.10 Banks
    if (Array.isArray(data.banks) && data.banks.length > 0) {
      for (const bank of data.banks) {
        allQueries.push({
          sql: `
            INSERT INTO banks (id, bank_code, bank_name, is_popular, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              bank_code=VALUES(bank_code),
              bank_name=VALUES(bank_name),
              is_popular=VALUES(is_popular),
              is_active=VALUES(is_active),
              created_at=VALUES(created_at)
          `,
          params: [
            bank.id,
            bank.bank_code,
            bank.bank_name,
            bank.is_popular || 0,
            bank.is_active !== undefined ? bank.is_active : 1,
            toMySQLTimestamp(bank.created_at || new Date())
          ]
        });
      }
      stats.banks = data.banks.length;
      console.log(`✅ [RESTORE] ${data.banks.length} banks restored`);
    }

    // 2.11 CL Accounts
    if (Array.isArray(data.clAccounts) && data.clAccounts.length > 0) {
      for (const cl of data.clAccounts) {
        allQueries.push({
          sql: `
            INSERT INTO cl_accounts (id, account_code, account_name, contact_info, credit_limit, current_balance, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              account_code=VALUES(account_code),
              account_name=VALUES(account_name),
              contact_info=VALUES(contact_info),
              credit_limit=VALUES(credit_limit),
              current_balance=VALUES(current_balance),
              is_active=VALUES(is_active),
              created_at=VALUES(created_at),
              updated_at=VALUES(updated_at)
          `,
          params: [
            cl.id,
            cl.account_code,
            cl.account_name,
            cl.contact_info || null,
            cl.credit_limit || 0,
            cl.current_balance || 0,
            cl.is_active !== undefined ? cl.is_active : 1,
            toMySQLTimestamp(cl.created_at || new Date()),
            toMySQLTimestamp(Date.now())
          ]
        });
      }
      stats.clAccounts = data.clAccounts.length;
      console.log(`✅ [RESTORE] ${data.clAccounts.length} CL accounts restored`);
    }

    // Execute all master data queries in a transaction (db_host)
    if (allQueries.length > 0) {
      await executeTransaction(allQueries);
      console.log(`✅ [RESTORE] Executed ${allQueries.length} master data queries`);
      await upsertMasterDataToSystemPos(allQueries);
    }

    // Step 3: Download and Restore Transactions (if requested)
    if (includeTransactions) {
      console.log('📥 [RESTORE] Step 3: Downloading transactions...');
      const transactionsUrl = `${apiUrl}/api/transactions?business_id=${businessId}&limit=10000`;
      const txResponse = await fetch(transactionsUrl);

      if (!txResponse.ok) {
        console.warn(`⚠️ [RESTORE] Failed to download transactions: ${txResponse.status}`);
      } else {
        const txData = await txResponse.json() as any;
        const transactions = txData.transactions || [];

        if (transactions.length > 0) {
          console.log(`💾 [RESTORE] Restoring ${transactions.length} transactions...`);
          const txQueries: Array<{ sql: string; params?: (string | number | null)[] }> = [];
          const now = Date.now();

          for (const tx of transactions) {
            const txId = tx.uuid_id || tx.id;
            txQueries.push({
              sql: `
                INSERT INTO transactions (
                  id, business_id, user_id, payment_method, payment_method_id,
                  pickup_method, total_amount, final_amount, amount_received, change_amount,
                  customer_name, status, created_at, updated_at, voucher_discount,
                  voucher_type, voucher_value, transaction_type, receipt_number, shift_uuid,
                  synced_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                  business_id=VALUES(business_id),
                  user_id=VALUES(user_id),
                  payment_method=VALUES(payment_method),
                  payment_method_id=VALUES(payment_method_id),
                  pickup_method=VALUES(pickup_method),
                  total_amount=VALUES(total_amount),
                  final_amount=VALUES(final_amount),
                  amount_received=VALUES(amount_received),
                  change_amount=VALUES(change_amount),
                  customer_name=VALUES(customer_name),
                  status=VALUES(status),
                  created_at=VALUES(created_at),
                  updated_at=VALUES(updated_at),
                  voucher_discount=VALUES(voucher_discount),
                  voucher_type=VALUES(voucher_type),
                  voucher_value=VALUES(voucher_value),
                  transaction_type=VALUES(transaction_type),
                  receipt_number=VALUES(receipt_number),
                  shift_uuid=VALUES(shift_uuid),
                  synced_at=VALUES(synced_at)
              `,
              params: [
                txId,
                tx.business_id || businessId,
                tx.user_id,
                tx.payment_method,
                tx.payment_method_id || null,
                tx.pickup_method,
                tx.total_amount || 0,
                tx.final_amount || 0,
                tx.amount_received || 0,
                tx.change_amount || 0,
                tx.customer_name || null,
                tx.status || 'completed',
                toMySQLTimestamp(tx.created_at || new Date()),
                toMySQLTimestamp(Date.now()),
                tx.voucher_discount || 0,
                tx.voucher_type || null,
                tx.voucher_value || null,
                tx.transaction_type || 'drinks',
                tx.receipt_number || null,
                tx.shift_uuid || null,
                now // Set synced_at to mark as already synced (downloaded from server)
              ]
            });
          }

          await executeTransaction(txQueries);
          stats.transactions = transactions.length;
          console.log(`✅ [RESTORE] ${transactions.length} transactions restored`);
        }
      }

      // Step 4: Download and Restore Transaction Items
      console.log('📥 [RESTORE] Step 4: Downloading transaction items...');
      const itemsUrl = `${apiUrl}/api/transaction-items?business_id=${businessId}&limit=50000`;
      console.log('📥 [RESTORE] URL:', itemsUrl);

      try {
        const itemsResponse = await fetch(itemsUrl);
        console.log('📥 [RESTORE] Response status:', itemsResponse.status);

        if (!itemsResponse.ok) {
          const errorText = await itemsResponse.text();
          console.warn(`⚠️ [RESTORE] Failed to download transaction items: ${itemsResponse.status}`, errorText);
        } else {
          const itemsData = await itemsResponse.json() as any;
          const items = itemsData.items || [];
          console.log('📥 [RESTORE] Received', items.length, 'transaction items');

          if (items.length > 0) {
            console.log(`💾 [RESTORE] Restoring ${items.length} transaction items...`);
            const itemQueries: Array<{ sql: string; params?: (string | number | null)[] }> = [];

            for (const item of items) {
              const itemId = item.uuid_id || item.id;
              const transactionId = item.uuid_transaction_id || item.transaction_id;

              // Convert bundle_selections_json to string if it's an object
              let bundleSelectionsStr = null;
              if (item.bundle_selections_json) {
                bundleSelectionsStr = typeof item.bundle_selections_json === 'string'
                  ? item.bundle_selections_json
                  : JSON.stringify(item.bundle_selections_json);
              }

              const itemWaiterId = typeof item.waiter_id === 'number' ? item.waiter_id : (typeof item.waiter_id === 'string' ? parseInt(String(item.waiter_id), 10) : null);
              itemQueries.push({
                sql: `
                  INSERT INTO transaction_items (
                    id, transaction_id, product_id, quantity, unit_price, total_price,
                    custom_note, bundle_selections_json, created_at, waiter_id
                  )
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON DUPLICATE KEY UPDATE
                    transaction_id=VALUES(transaction_id),
                    product_id=VALUES(product_id),
                    quantity=VALUES(quantity),
                    unit_price=VALUES(unit_price),
                    total_price=VALUES(total_price),
                    custom_note=VALUES(custom_note),
                    bundle_selections_json=VALUES(bundle_selections_json),
                    created_at=VALUES(created_at),
                    waiter_id=VALUES(waiter_id)
                `,
                params: [
                  itemId,
                  transactionId,
                  item.product_id,
                  item.quantity || 1,
                  item.unit_price || 0,
                  item.total_price || 0,
                  item.custom_note || null,
                  bundleSelectionsStr,
                  toMySQLTimestamp(item.created_at || new Date()),
                  itemWaiterId
                ]
              });
            }

            await executeTransaction(itemQueries);
            stats.transactionItems = items.length;
            console.log(`✅ [RESTORE] ${items.length} transaction items restored`);
          } else {
            console.warn('⚠️ [RESTORE] No transaction items found in response');
          }
        }
      } catch (itemsError) {
        console.error('❌ [RESTORE] Error downloading transaction items:', itemsError);
      }

      // Step 5: Restore Transaction Item Customizations (from /api/sync)
      console.log('💾 [RESTORE] Step 5: Restoring transaction item customizations...');
      if (Array.isArray(data.transactionItemCustomizations) && data.transactionItemCustomizations.length > 0) {
        const ticQueries: Array<{ sql: string; params?: (string | number | null)[] }> = [];
        for (const tic of data.transactionItemCustomizations) {
          ticQueries.push({
            sql: `
              INSERT INTO transaction_item_customizations (
                id, transaction_item_id, customization_type_id, bundle_product_id, created_at
              ) VALUES (?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                transaction_item_id=VALUES(transaction_item_id),
                customization_type_id=VALUES(customization_type_id),
                bundle_product_id=VALUES(bundle_product_id),
                created_at=VALUES(created_at)
            `,
            params: [
              tic.id,
              tic.transaction_item_id,
              tic.customization_type_id,
              tic.bundle_product_id || null,
              toMySQLTimestamp(tic.created_at || new Date())
            ]
          });
        }
        await executeTransaction(ticQueries);
        stats.transactionItemCustomizations = data.transactionItemCustomizations.length;
        console.log(`✅ [RESTORE] ${data.transactionItemCustomizations.length} transaction item customizations restored`);
      }

      // Step 6: Restore Transaction Item Customization Options (from /api/sync)
      console.log('💾 [RESTORE] Step 6: Restoring transaction item customization options...');
      if (Array.isArray(data.transactionItemCustomizationOptions) && data.transactionItemCustomizationOptions.length > 0) {
        const ticoQueries: Array<{ sql: string; params?: (string | number | null)[] }> = [];
        for (const tico of data.transactionItemCustomizationOptions) {
          ticoQueries.push({
            sql: `
              INSERT INTO transaction_item_customization_options (
                id, transaction_item_customization_id, customization_option_id, option_name, price_adjustment, created_at
              ) VALUES (?, ?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                transaction_item_customization_id=VALUES(transaction_item_customization_id),
                customization_option_id=VALUES(customization_option_id),
                option_name=VALUES(option_name),
                price_adjustment=VALUES(price_adjustment),
                created_at=VALUES(created_at)
            `,
            params: [
              tico.id,
              tico.transaction_item_customization_id,
              tico.customization_option_id,
              tico.option_name,
              tico.price_adjustment || 0,
              toMySQLTimestamp(tico.created_at || new Date())
            ]
          });
        }
        await executeTransaction(ticoQueries);
        stats.transactionItemCustomizationOptions = data.transactionItemCustomizationOptions.length;
        console.log(`✅ [RESTORE] ${data.transactionItemCustomizationOptions.length} transaction item customization options restored`);
      }

      // Step 7: Restore Shifts (from /api/sync)
      console.log('💾 [RESTORE] Step 7: Restoring shifts...');
      if (Array.isArray(data.shifts) && data.shifts.length > 0) {
        const shiftQueries: Array<{ sql: string; params?: (string | number | null)[] }> = [];
        for (const shift of data.shifts) {
          shiftQueries.push({
            sql: `
              INSERT INTO shifts (
                id, uuid_id, business_id, user_id, user_name, shift_start, shift_end,
                modal_awal, kas_akhir, kas_expected, kas_selisih, kas_selisih_label,
                cash_sales_total, cash_refund_total, status, created_at, updated_at, synced_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                business_id=VALUES(business_id),
                user_id=VALUES(user_id),
                user_name=VALUES(user_name),
                shift_start=VALUES(shift_start),
                shift_end=VALUES(shift_end),
                modal_awal=VALUES(modal_awal),
                kas_akhir=VALUES(kas_akhir),
                kas_expected=VALUES(kas_expected),
                kas_selisih=VALUES(kas_selisih),
                kas_selisih_label=VALUES(kas_selisih_label),
                cash_sales_total=VALUES(cash_sales_total),
                cash_refund_total=VALUES(cash_refund_total),
                status=VALUES(status),
                created_at=VALUES(created_at),
                updated_at=VALUES(updated_at),
                synced_at=VALUES(synced_at)
            `,
            params: [
              shift.id || null,
              shift.uuid_id,
              shift.business_id,
              shift.user_id,
              shift.user_name,
              toMySQLDateTime(shift.shift_start),
              shift.shift_end ? toMySQLDateTime(shift.shift_end) : null,
              shift.modal_awal || 0,
              shift.kas_akhir || null,
              shift.kas_expected || null,
              shift.kas_selisih || null,
              shift.kas_selisih_label || 'balanced',
              shift.cash_sales_total || null,
              shift.cash_refund_total || null,
              shift.status || 'active',
              toMySQLDateTime(shift.created_at || new Date()),
              shift.updated_at ? (typeof shift.updated_at === 'number' ? shift.updated_at : parseInt(String(shift.updated_at), 10)) : null,
              shift.synced_at ? (typeof shift.synced_at === 'number' ? shift.synced_at : parseInt(String(shift.synced_at), 10)) : null
            ]
          });
        }
        await executeTransaction(shiftQueries);
        stats.shifts = data.shifts.length;
        console.log(`✅ [RESTORE] ${data.shifts.length} shifts restored`);
      }

      // Step 8: Restore Transaction Refunds (from /api/sync)
      console.log('💾 [RESTORE] Step 8: Restoring transaction refunds...');
      if (Array.isArray(data.transactionRefunds) && data.transactionRefunds.length > 0) {
        const refundQueries: Array<{ sql: string; params?: (string | number | null)[] }> = [];
        for (const refund of data.transactionRefunds) {
          refundQueries.push({
            sql: `
              INSERT INTO transaction_refunds (
                id, uuid_id, transaction_uuid, business_id, shift_uuid, refunded_by,
                refund_amount, cash_delta, payment_method_id, reason, note, refund_type,
                status, refunded_at, created_at, updated_at, synced_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                transaction_uuid=VALUES(transaction_uuid),
                business_id=VALUES(business_id),
                shift_uuid=VALUES(shift_uuid),
                refunded_by=VALUES(refunded_by),
                refund_amount=VALUES(refund_amount),
                cash_delta=VALUES(cash_delta),
                payment_method_id=VALUES(payment_method_id),
                reason=VALUES(reason),
                note=VALUES(note),
                refund_type=VALUES(refund_type),
                status=VALUES(status),
                refunded_at=VALUES(refunded_at),
                created_at=VALUES(created_at),
                updated_at=VALUES(updated_at),
                synced_at=VALUES(synced_at)
            `,
            params: [
              refund.id || null,
              refund.uuid_id,
              refund.transaction_uuid,
              refund.business_id,
              refund.shift_uuid || null,
              refund.refunded_by,
              refund.refund_amount,
              refund.cash_delta || 0,
              refund.payment_method_id || null,
              refund.reason || null,
              refund.note || null,
              refund.refund_type || 'full',
              refund.status || 'completed',
              refund.refunded_at,
              toMySQLDateTime(refund.created_at || new Date()),
              refund.updated_at ? toMySQLDateTime(typeof refund.updated_at === 'number' ? new Date(refund.updated_at) : refund.updated_at) : null,
              refund.synced_at ? toMySQLDateTime(typeof refund.synced_at === 'number' ? new Date(refund.synced_at) : refund.synced_at) : null
            ]
          });
        }
        await executeTransaction(refundQueries);
        stats.transactionRefunds = data.transactionRefunds.length;
        console.log(`✅ [RESTORE] ${data.transactionRefunds.length} transaction refunds restored`);
      }

      // Step 9: Restore Printer 1 Audit Logs (from /api/sync)
      console.log('💾 [RESTORE] Step 9: Restoring printer 1 audit logs...');
      if (Array.isArray(data.printer1AuditLog) && data.printer1AuditLog.length > 0) {
        const p1Queries: Array<{ sql: string; params?: (string | number | null)[] }> = [];
        for (const p1 of data.printer1AuditLog) {
          p1Queries.push({
            sql: `
              INSERT INTO printer1_audit_log (
                id, transaction_id, printer1_receipt_number, global_counter,
                printed_at, printed_at_epoch, is_reprint, reprint_count, synced_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                transaction_id=VALUES(transaction_id),
                printer1_receipt_number=VALUES(printer1_receipt_number),
                global_counter=VALUES(global_counter),
                printed_at=VALUES(printed_at),
                printed_at_epoch=VALUES(printed_at_epoch),
                is_reprint=VALUES(is_reprint),
                reprint_count=VALUES(reprint_count),
                synced_at=VALUES(synced_at)
            `,
            params: [
              p1.id || null,
              p1.transaction_id,
              p1.printer1_receipt_number,
              p1.global_counter || null,
              p1.printed_at,
              p1.printed_at_epoch,
              p1.is_reprint || 0,
              p1.reprint_count || 0,
              p1.synced_at || Date.now()
            ]
          });
        }
        await executeTransaction(p1Queries);
        stats.printer1AuditLog = data.printer1AuditLog.length;
        console.log(`✅ [RESTORE] ${data.printer1AuditLog.length} printer 1 audit logs restored`);
      }

      // Step 10: Restore Printer 2 Audit Logs (from /api/sync)
      console.log('💾 [RESTORE] Step 10: Restoring printer 2 audit logs...');
      if (Array.isArray(data.printer2AuditLog) && data.printer2AuditLog.length > 0) {
        const p2Queries: Array<{ sql: string; params?: (string | number | null)[] }> = [];
        for (const p2 of data.printer2AuditLog) {
          p2Queries.push({
            sql: `
              INSERT INTO printer2_audit_log (
                id, transaction_id, printer2_receipt_number, print_mode, cycle_number,
                global_counter, printed_at, printed_at_epoch, is_reprint, reprint_count, synced_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                transaction_id=VALUES(transaction_id),
                printer2_receipt_number=VALUES(printer2_receipt_number),
                print_mode=VALUES(print_mode),
                cycle_number=VALUES(cycle_number),
                global_counter=VALUES(global_counter),
                printed_at=VALUES(printed_at),
                printed_at_epoch=VALUES(printed_at_epoch),
                is_reprint=VALUES(is_reprint),
                reprint_count=VALUES(reprint_count),
                synced_at=VALUES(synced_at)
            `,
            params: [
              p2.id || null,
              p2.transaction_id,
              p2.printer2_receipt_number,
              p2.print_mode || 'auto',
              p2.cycle_number || null,
              p2.global_counter || null,
              p2.printed_at,
              p2.printed_at_epoch,
              p2.is_reprint || 0,
              p2.reprint_count || 0,
              p2.synced_at || Date.now()
            ]
          });
        }
        await executeTransaction(p2Queries);
        stats.printer2AuditLog = data.printer2AuditLog.length;
        console.log(`✅ [RESTORE] ${data.printer2AuditLog.length} printer 2 audit logs restored`);
      }
    }

    console.log('✅ [RESTORE] Full restore completed successfully!');
    console.log('📊 [RESTORE] Stats:', stats);

    return {
      success: true,
      message: 'Database restored successfully',
      stats
    };

  } catch (error) {
    console.error('❌ [RESTORE] Restore failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during restore',
      stats
    };
  }
});

// IPC handlers for Restaurant Table Layout
ipcMain.handle('get-restaurant-rooms', async (event, businessId: number) => {
  try {
    const query = `
      SELECT 
        rr.id,
        rr.business_id,
        rr.name,
        rr.canvas_width,
        rr.canvas_height,
        rr.font_size_multiplier,
        rr.created_at,
        rr.updated_at,
        COUNT(rt.id) as table_count
      FROM restaurant_rooms rr
      LEFT JOIN restaurant_tables rt ON rr.id = rt.room_id
      WHERE rr.business_id = ?
      GROUP BY rr.id, rr.business_id, rr.name, rr.canvas_width, rr.canvas_height, rr.font_size_multiplier, rr.created_at, rr.updated_at
      ORDER BY rr.name ASC
    `;
    const result = await executeQuery<RowArray>(query, [businessId]); return result;
  } catch (error) {
    console.error('Error getting restaurant rooms:', error); return [];
  }
});

ipcMain.handle('get-restaurant-tables', async (event, roomId: number) => {
  try {
    const query = `
      SELECT * FROM restaurant_tables
      WHERE room_id = ?
      ORDER BY table_number ASC
    `;
    return await executeQuery<RowArray>(query, [roomId]);
  } catch (error) {
    console.error('Error getting restaurant tables:', error);
    return [];
  }
});

ipcMain.handle('get-restaurant-layout-elements', async (event, roomId: number) => {
  try {
    const query = `
      SELECT * FROM restaurant_layout_elements
      WHERE room_id = ?
      ORDER BY label ASC
    `;
    return await executeQuery<RowArray>(query, [roomId]);
  } catch (error) {
    console.error('Error getting restaurant layout elements:', error);
    return [];
  }
});

// IPC handlers for syncing restaurant table layout data
ipcMain.handle('localdb-upsert-restaurant-rooms', async (event, rows: RowArray) => {
  try {
    const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];
    let skippedCount = 0;

    for (const r of rows) {
      const getId = () => {
        const val = r.id;
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          const num = Number(val);
          return isNaN(num) ? null : num;
        }
        return null;
      };
      const getNumber = (key: string) => {
        const val = r[key];
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          const num = Number(val);
          return isNaN(num) ? null : num;
        }
        return null;
      };
      const getString = (key: string) => (typeof r[key] === 'string' ? r[key] as string : null);
      const getDate = (key: string) => {
        const val = r[key];
        if (val instanceof Date) return val;
        if (typeof val === 'string' || typeof val === 'number') return val;
        return null;
      };

      const roomId = getId();
      const businessId = getNumber('business_id');

      // Verify business_id exists before inserting (foreign key constraint)
      if (businessId) {
        try {
          const businessExists = await executeQueryOne<{ id: number }>('SELECT id FROM businesses WHERE id = ? LIMIT 1', [businessId]);
          if (!businessExists) {
            console.warn(`⚠️ [RESTAURANT ROOMS] Skipping room ${roomId}: business_id ${businessId} does not exist`);
            skippedCount++;
            continue;
          }
        } catch (checkError) {
          console.warn(`⚠️ [RESTAURANT ROOMS] Failed to verify business_id ${businessId}:`, checkError);
          skippedCount++;
          continue;
        }
      }

      const createdDate = getDate('created_at');
      const updatedDate = getDate('updated_at');
      const createdAt = createdDate ? toMySQLDateTime(createdDate as string | number | Date) : toMySQLDateTime(new Date());
      const updatedAt = updatedDate ? toMySQLDateTime(updatedDate as string | number | Date) : toMySQLDateTime(new Date());

      queries.push({
        sql: `INSERT INTO restaurant_rooms (
          id, business_id, name, canvas_width, canvas_height, font_size_multiplier, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          business_id=VALUES(business_id),
          name=VALUES(name),
          canvas_width=VALUES(canvas_width),
          canvas_height=VALUES(canvas_height),
          font_size_multiplier=VALUES(font_size_multiplier),
          created_at=VALUES(created_at),
          updated_at=VALUES(updated_at)`,
        params: [
          roomId,
          businessId,
          getString('name'),
          getNumber('canvas_width'),
          getNumber('canvas_height'),
          getNumber('font_size_multiplier') ?? 1.0,
          createdAt,
          updatedAt
        ]
      });
    }

    if (queries.length > 0) {
      await executeTransaction(queries);
      await upsertMasterDataToSystemPos(queries);
      if (skippedCount > 0) {
        console.log(`⚠️ [RESTAURANT ROOMS] Skipped ${skippedCount} rooms due to missing businesses`);
      }
    } else {
      console.warn(`⚠️ [RESTAURANT ROOMS] No valid rooms to insert (all ${rows.length} skipped)`);
    }
    return { success: true };
  } catch (error) {
    console.error('Error upserting restaurant rooms:', error); return { success: false };
  }
});

ipcMain.handle('localdb-upsert-restaurant-tables', async (event, rows: RowArray) => {
  try {
    const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];
    let skippedCount = 0;

    for (const r of rows) {
      const getId = () => {
        const val = r.id;
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          const num = Number(val);
          return isNaN(num) ? null : num;
        }
        return null;
      };
      const getNumber = (key: string) => {
        const val = r[key];
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          const num = Number(val);
          return isNaN(num) ? null : num;
        }
        return null;
      };
      const getString = (key: string) => (typeof r[key] === 'string' ? r[key] as string : null);
      const getDate = (key: string) => {
        const val = r[key];
        if (val instanceof Date) return val;
        if (typeof val === 'string' || typeof val === 'number') return val;
        return null;
      };

      const tableId = getId();
      const roomId = getNumber('room_id');

      // Verify room_id exists before inserting (foreign key constraint)
      if (roomId) {
        try {
          const roomExists = await executeQueryOne<{ id: number }>('SELECT id FROM restaurant_rooms WHERE id = ? LIMIT 1', [roomId]);
          if (!roomExists) {
            console.warn(`⚠️ [RESTAURANT TABLES] Skipping table ${tableId}: room_id ${roomId} does not exist`);
            skippedCount++;
            continue;
          }
        } catch (checkError) {
          console.warn(`⚠️ [RESTAURANT TABLES] Failed to verify room_id ${roomId}:`, checkError);
          skippedCount++;
          continue;
        }
      }

      const createdDate = getDate('created_at');
      const updatedDate = getDate('updated_at');
      const createdAt = createdDate ? toMySQLDateTime(createdDate as string | number | Date) : toMySQLDateTime(new Date());
      const updatedAt = updatedDate ? toMySQLDateTime(updatedDate as string | number | Date) : toMySQLDateTime(new Date());

      queries.push({
        sql: `INSERT INTO restaurant_tables (
          id, room_id, table_number, position_x, position_y, width, height, capacity, shape, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          room_id=VALUES(room_id),
          table_number=VALUES(table_number),
          position_x=VALUES(position_x),
          position_y=VALUES(position_y),
          width=VALUES(width),
          height=VALUES(height),
          capacity=VALUES(capacity),
          shape=VALUES(shape),
          created_at=VALUES(created_at),
          updated_at=VALUES(updated_at)`,
        params: [
          tableId,
          roomId,
          getString('table_number'),
          getNumber('position_x') ?? 0.0,
          getNumber('position_y') ?? 0.0,
          getNumber('width') ?? 5.0,
          getNumber('height') ?? 5.0,
          getNumber('capacity') ?? 4,
          getString('shape') ?? 'circle',
          createdAt,
          updatedAt
        ]
      });
    }

    if (queries.length > 0) {
      await executeTransaction(queries);
      await upsertMasterDataToSystemPos(queries);
      if (skippedCount > 0) {
        console.log(`⚠️ [RESTAURANT TABLES] Skipped ${skippedCount} tables due to missing rooms`);
      }
    } else {
      console.warn(`⚠️ [RESTAURANT TABLES] No valid tables to insert (all ${rows.length} skipped)`);
    }
    return { success: true };
  } catch (error) {
    console.error('Error upserting restaurant tables:', error);
    return { success: false };
  }
});

ipcMain.handle('localdb-upsert-restaurant-layout-elements', async (event, rows: RowArray) => {
  try {
    const queries: Array<{ sql: string; params?: (string | number | null | boolean)[] }> = [];
    let skippedCount = 0;

    for (const r of rows) {
      const getId = () => {
        const val = r.id;
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          const num = Number(val);
          return isNaN(num) ? null : num;
        }
        return null;
      };
      const getNumber = (key: string) => {
        const val = r[key];
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          const num = Number(val);
          return isNaN(num) ? null : num;
        }
        return null;
      };
      const getString = (key: string) => (typeof r[key] === 'string' ? r[key] as string : null);
      const getDate = (key: string) => {
        const val = r[key];
        if (val instanceof Date) return val;
        if (typeof val === 'string' || typeof val === 'number') return val;
        return null;
      };

      const elementId = getId();
      const roomId = getNumber('room_id');

      // Verify room_id exists before inserting (foreign key constraint)
      if (roomId) {
        try {
          const roomExists = await executeQueryOne<{ id: number }>('SELECT id FROM restaurant_rooms WHERE id = ? LIMIT 1', [roomId]);
          if (!roomExists) {
            console.warn(`⚠️ [RESTAURANT LAYOUT ELEMENTS] Skipping element ${elementId}: room_id ${roomId} does not exist`);
            skippedCount++;
            continue;
          }
        } catch (checkError) {
          console.warn(`⚠️ [RESTAURANT LAYOUT ELEMENTS] Failed to verify room_id ${roomId}:`, checkError);
          skippedCount++;
          continue;
        }
      }

      const createdDate = getDate('created_at');
      const updatedDate = getDate('updated_at');
      const createdAt = createdDate ? toMySQLDateTime(createdDate as string | number | Date) : toMySQLDateTime(new Date());
      const updatedAt = updatedDate ? toMySQLDateTime(updatedDate as string | number | Date) : toMySQLDateTime(new Date());

      queries.push({
        sql: `INSERT INTO restaurant_layout_elements (
          id, room_id, label, position_x, position_y, width, height, element_type, color, text_color, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          room_id=VALUES(room_id),
          label=VALUES(label),
          position_x=VALUES(position_x),
          position_y=VALUES(position_y),
          width=VALUES(width),
          height=VALUES(height),
          element_type=VALUES(element_type),
          color=VALUES(color),
          text_color=VALUES(text_color),
          created_at=VALUES(created_at),
          updated_at=VALUES(updated_at)`,
        params: [
          elementId,
          roomId,
          getString('label'),
          getNumber('position_x') ?? 0.0,
          getNumber('position_y') ?? 0.0,
          getNumber('width') ?? 4.0,
          getNumber('height') ?? 4.0,
          getString('element_type') ?? 'custom',
          getString('color') ?? '#9CA3AF',
          getString('text_color') ?? '#000000',
          createdAt,
          updatedAt
        ]
      });
    }

    if (queries.length === 0) {
      console.log('[IPC] localdb-upsert-restaurant-layout-elements: No valid queries to execute');
      return { success: true, skipped: skippedCount };
    }

    await executeTransaction(queries);
    console.log('[IPC] localdb-upsert-restaurant-layout-elements transaction completed:', { queriesExecuted: queries.length, skippedCount, totalRows: Array.isArray(rows) ? rows.length : 0 });
    return { success: true, skipped: skippedCount };
  } catch (error) {
    console.error('[IPC] localdb-upsert-restaurant-layout-elements error details:', { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined, rowCount: Array.isArray(rows) ? rows.length : 'not array' });
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});


