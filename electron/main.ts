import { app, BrowserWindow, Menu, ipcMain, screen, protocol } from 'electron';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { PrinterManagementService } from './printerManagement';

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
};

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
const readCustomizationsFromNormalizedTables = (
  db: Database.Database,
  transactionItemId: string,
  bundleProductId?: number | null
): RawCustomization[] | null => {
  try {
    // Read from normalized tables - filter by bundle_product_id
    const customizations = db.prepare(`
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
    `).all(transactionItemId, bundleProductId || null, bundleProductId || null) as Array<{
      customization_id: number;
      customization_name: string;
      option_id: number | null;
      option_name: string | null;
      price_adjustment: number | null;
      bundle_product_id: number | null;
    }>;

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
const saveCustomizationsToNormalizedTables = (
  db: Database.Database,
  transactionItemId: string,
  customizations: RawCustomization[] | null | undefined,
  createdAt: string,
  bundleProductId?: number | null  // NULL or undefined = main product, number = bundle product ID
): void => {
  if (!customizations || !Array.isArray(customizations) || customizations.length === 0) {
    return;
  }

  try {
    // Delete existing normalized data for this transaction item and bundle product (in case of update)
    // If bundleProductId is provided, only delete customizations for that specific bundle product
    // If bundleProductId is null/undefined, delete main product customizations (bundle_product_id IS NULL)
    const deleteStmt = db.prepare(`
      DELETE FROM transaction_item_customization_options 
      WHERE transaction_item_customization_id IN (
        SELECT id FROM transaction_item_customizations 
        WHERE transaction_item_id = ? 
          AND (bundle_product_id IS NULL AND ? IS NULL OR bundle_product_id = ?)
      )
    `);
    const deleteTicStmt = db.prepare(`
      DELETE FROM transaction_item_customizations 
      WHERE transaction_item_id = ? 
        AND (bundle_product_id IS NULL AND ? IS NULL OR bundle_product_id = ?)
    `);
    
    deleteStmt.run(transactionItemId, bundleProductId || null, bundleProductId || null);
    deleteTicStmt.run(transactionItemId, bundleProductId || null, bundleProductId || null);

    // Insert into normalized tables
    const insertTicStmt = db.prepare(`
      INSERT INTO transaction_item_customizations (transaction_item_id, customization_type_id, bundle_product_id, created_at)
      VALUES (?, ?, ?, ?)
    `);
    
    const insertTicoStmt = db.prepare(`
      INSERT INTO transaction_item_customization_options (
        transaction_item_customization_id, customization_option_id, option_name, price_adjustment, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `);

    for (const customization of customizations) {
      const customizationId = Number(customization.customization_id);
      if (!customizationId || Number.isNaN(customizationId)) {
        console.warn('⚠️ Invalid customization_id:', customization.customization_id);
        continue;
      }

      // Insert customization type link
      const ticResult = insertTicStmt.run(transactionItemId, customizationId, bundleProductId || null, createdAt);
      const ticId = (ticResult as { lastInsertRowid: number }).lastInsertRowid;

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

          insertTicoStmt.run(
            ticId,
            optionId,
            optionName,
            priceAdjustment,
            createdAt
          );
        }
      }
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

if (!shouldLog) {
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
}

// Global references to windows and services
let mainWindow: BrowserWindow | null = null;
let customerWindow: BrowserWindow | null = null;
let printWindow: BrowserWindow | null = null;
let localDb: Database.Database | null = null;
let printerService: PrinterManagementService | null = null;

function getLocalDbPath(): string {
  // Use userData directory for consistent database location across dev/prod
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'pos-offline.db');
}

function createWindows(): void {
  // Initialize local SQLite (offline storage)
  try {
    console.log('🔍 Initializing SQLite database for offline support...');
    const dbPath = getLocalDbPath();
    localDb = new Database(dbPath);
    
    // Enable WAL mode for better concurrency
    localDb.pragma('journal_mode = WAL');
    localDb.pragma('synchronous = NORMAL');
    localDb.pragma('cache_size = 10000');
    localDb.pragma('temp_store = MEMORY');
    
    // Schema migration: Add synced_at column if it doesn't exist
    try {
      const schemaCheck = localDb.prepare(`PRAGMA table_info(transactions)`).all() as TableInfoRow[];
      const hasSyncedAt = schemaCheck.some(col => col.name === 'synced_at');
      
      if (!hasSyncedAt) {
        console.log('📋 Migrating database: Adding synced_at column...');
        localDb.prepare(`ALTER TABLE transactions ADD COLUMN synced_at INTEGER`).run();
        console.log('✅ Migration complete');
      }
      const hasVoucherType = schemaCheck.some(col => col.name === 'voucher_type');
      if (!hasVoucherType) {
        console.log('📋 Migrating database: Adding transactions.voucher_type column...');
        localDb.prepare(`ALTER TABLE transactions ADD COLUMN voucher_type TEXT DEFAULT 'none'`).run();
      }
      const hasVoucherValue = schemaCheck.some(col => col.name === 'voucher_value');
      if (!hasVoucherValue) {
        console.log('📋 Migrating database: Adding transactions.voucher_value column...');
        localDb.prepare(`ALTER TABLE transactions ADD COLUMN voucher_value REAL`).run();
      }
      const hasVoucherLabel = schemaCheck.some(col => col.name === 'voucher_label');
      if (!hasVoucherLabel) {
        console.log('📋 Migrating database: Adding transactions.voucher_label column...');
        localDb.prepare(`ALTER TABLE transactions ADD COLUMN voucher_label TEXT`).run();
      }
      const hasCustomerUnit = schemaCheck.some(col => col.name === 'customer_unit');
      if (!hasCustomerUnit) {
        console.log('📋 Migrating database: Adding transactions.customer_unit column...');
        localDb.prepare(`ALTER TABLE transactions ADD COLUMN customer_unit INTEGER`).run();
      }
      const hasRefundStatus = schemaCheck.some(col => col.name === 'refund_status');
      if (!hasRefundStatus) {
        console.log('📋 Migrating database: Adding transactions.refund_status column...');
        localDb.prepare(`ALTER TABLE transactions ADD COLUMN refund_status TEXT DEFAULT 'none'`).run();
      }
      const hasRefundTotal = schemaCheck.some(col => col.name === 'refund_total');
      if (!hasRefundTotal) {
        console.log('📋 Migrating database: Adding transactions.refund_total column...');
        localDb.prepare(`ALTER TABLE transactions ADD COLUMN refund_total REAL DEFAULT 0.0`).run();
      }
      const hasLastRefundedAt = schemaCheck.some(col => col.name === 'last_refunded_at');
      if (!hasLastRefundedAt) {
        console.log('📋 Migrating database: Adding transactions.last_refunded_at column...');
        localDb.prepare(`ALTER TABLE transactions ADD COLUMN last_refunded_at TEXT`).run();
      }
    } catch (e) {
      console.log('⚠️ Migration check failed:', e);
    }

    // Schema migration: ensure new cash tracking columns exist on shifts
    try {
      const shiftSchema = localDb.prepare(`PRAGMA table_info(shifts)`).all() as TableInfoRow[];
      const hasKasAkhir = shiftSchema.some(col => col.name === 'kas_akhir');
      if (!hasKasAkhir) {
        console.log('📋 Migrating database: Adding shifts.kas_akhir column...');
        localDb.prepare(`ALTER TABLE shifts ADD COLUMN kas_akhir REAL`).run();
      }
      const hasKasExpected = shiftSchema.some(col => col.name === 'kas_expected');
      if (!hasKasExpected) {
        console.log('📋 Migrating database: Adding shifts.kas_expected column...');
        localDb.prepare(`ALTER TABLE shifts ADD COLUMN kas_expected REAL`).run();
      }
      const hasKasSelisih = shiftSchema.some(col => col.name === 'kas_selisih');
      if (!hasKasSelisih) {
        console.log('📋 Migrating database: Adding shifts.kas_selisih column...');
        localDb.prepare(`ALTER TABLE shifts ADD COLUMN kas_selisih REAL`).run();
      }
      const hasKasSelisihLabel = shiftSchema.some(col => col.name === 'kas_selisih_label');
      if (!hasKasSelisihLabel) {
        console.log('📋 Migrating database: Adding shifts.kas_selisih_label column...');
        localDb.prepare(`ALTER TABLE shifts ADD COLUMN kas_selisih_label TEXT DEFAULT 'balanced'`).run();
      }
      const hasCashSalesTotal = shiftSchema.some(col => col.name === 'cash_sales_total');
      if (!hasCashSalesTotal) {
        console.log('📋 Migrating database: Adding shifts.cash_sales_total column...');
        localDb.prepare(`ALTER TABLE shifts ADD COLUMN cash_sales_total REAL`).run();
      }
      const hasCashRefundTotal = shiftSchema.some(col => col.name === 'cash_refund_total');
      if (!hasCashRefundTotal) {
        console.log('📋 Migrating database: Adding shifts.cash_refund_total column...');
        localDb.prepare(`ALTER TABLE shifts ADD COLUMN cash_refund_total REAL`).run();
      }
    } catch (shiftError) {
      console.log('⚠️ Shift migration check failed:', shiftError);
    }

      // Schema migration: Ensure platform price columns exist on products
      try {
        const productSchema = localDb.prepare(`PRAGMA table_info(products)`).all() as TableInfoRow[];
        const hasHargaGofood = productSchema.some(col => col.name === 'harga_gofood');
        const hasHargaGrabfood = productSchema.some(col => col.name === 'harga_grabfood');
        const hasHargaShopeefood = productSchema.some(col => col.name === 'harga_shopeefood');
        const hasHargaTiktok = productSchema.some(col => col.name === 'harga_tiktok');
        const hasHargaQpon = productSchema.some(col => col.name === 'harga_qpon');
        const hasCategory2Name = productSchema.some(col => col.name === 'category2_name');
        const hasCategory2Id = productSchema.some(col => col.name === 'category2_id');
        const hasIsBundle = productSchema.some(col => col.name === 'is_bundle');

        if (!hasCategory2Id) {
          console.log('📋 Migrating database: Adding products.category2_id column...');
          localDb.prepare('ALTER TABLE products ADD COLUMN category2_id INTEGER').run();
          // Try to backfill category2_id from category2 table using category2_name
          try {
            localDb.prepare(`
              UPDATE products 
              SET category2_id = (
                SELECT c2.id 
                FROM category2 c2 
                WHERE c2.name = products.category2_name 
                LIMIT 1
              )
              WHERE category2_name IS NOT NULL AND category2_name != ''
            `).run();
            console.log('✅ Backfilled category2_id from category2 table');
          } catch (e) {
            console.log('⚠️ Failed to backfill category2_id:', e);
          }
        }
        if (!hasHargaGofood) {
          console.log('📋 Migrating database: Adding products.harga_gofood column...');
          localDb.prepare('ALTER TABLE products ADD COLUMN harga_gofood REAL').run();
        }
        if (!hasHargaGrabfood) {
          console.log('📋 Migrating database: Adding products.harga_grabfood column...');
          localDb.prepare('ALTER TABLE products ADD COLUMN harga_grabfood REAL').run();
        }
        if (!hasHargaShopeefood) {
          console.log('📋 Migrating database: Adding products.harga_shopeefood column...');
          localDb.prepare('ALTER TABLE products ADD COLUMN harga_shopeefood REAL').run();
        }
        if (!hasHargaTiktok) {
          console.log('📋 Migrating database: Adding products.harga_tiktok column...');
          localDb.prepare('ALTER TABLE products ADD COLUMN harga_tiktok REAL').run();
        }
        if (!hasHargaQpon) {
          console.log('📋 Migrating database: Adding products.harga_qpon column...');
          localDb.prepare('ALTER TABLE products ADD COLUMN harga_qpon REAL').run();
        }
        if (!hasCategory2Name) {
          console.log('📋 Migrating database: Adding products.category2_name column...');
          localDb.prepare('ALTER TABLE products ADD COLUMN category2_name TEXT').run();
          // Backfill from existing jenis if present
          try {
            localDb.prepare('UPDATE products SET category2_name = jenis WHERE category2_name IS NULL').run();
            console.log('✅ Backfilled category2_name from jenis');
          } catch (e) {
            console.log('⚠️ Failed to backfill category2_name from jenis:', e);
          }
        }
        if (!hasIsBundle) {
          console.log('📋 Migrating database: Adding products.is_bundle column...');
          localDb.prepare('ALTER TABLE products ADD COLUMN is_bundle INTEGER DEFAULT 0').run();
        }
      } catch (e) {
        console.log('⚠️ Products table migration check failed:', e);
      }

      // Schema migration: Bundle feature tables
      try {
        // Check if bundle_items table exists
        const bundleItemsExists = localDb.prepare(`
          SELECT name FROM sqlite_master WHERE type='table' AND name='bundle_items'
        `).get();
        
        if (!bundleItemsExists) {
          console.log('📋 Migrating database: Creating bundle_items table...');
          localDb.prepare(`
            CREATE TABLE bundle_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              bundle_product_id INTEGER NOT NULL,
              category2_id INTEGER NOT NULL,
              required_quantity INTEGER NOT NULL DEFAULT 1,
              display_order INTEGER DEFAULT 0,
              created_at TEXT,
              updated_at INTEGER,
              FOREIGN KEY (bundle_product_id) REFERENCES products(id) ON DELETE CASCADE,
              FOREIGN KEY (category2_id) REFERENCES category2(id) ON DELETE CASCADE
            )
          `).run();
          console.log('✅ Created bundle_items table');
        }

        // Check if transaction_item_customizations has bundle_product_id column
        try {
          const ticSchema = localDb.prepare(`PRAGMA table_info(transaction_item_customizations)`).all() as TableInfoRow[];
          const hasBundleProductId = ticSchema.some(col => col.name === 'bundle_product_id');
          if (!hasBundleProductId) {
            console.log('📋 Migrating database: Adding bundle_product_id to transaction_item_customizations...');
            localDb.prepare('ALTER TABLE transaction_item_customizations ADD COLUMN bundle_product_id INTEGER DEFAULT NULL').run();
            // Add index for the new column
            localDb.prepare('CREATE INDEX IF NOT EXISTS idx_tic_bundle_product ON transaction_item_customizations(bundle_product_id)').run();
            localDb.prepare('CREATE INDEX IF NOT EXISTS idx_tic_item_bundle ON transaction_item_customizations(transaction_item_id, bundle_product_id)').run();
            console.log('✅ Added bundle_product_id column');
          }
        } catch (error) {
          console.warn('⚠️ Error checking/adding bundle_product_id column:', error);
        }

        // Check if transaction_items has bundle_selections_json column
        const transactionItemsSchema = localDb.prepare(`PRAGMA table_info(transaction_items)`).all() as TableInfoRow[];
        const hasBundleSelections = transactionItemsSchema.some(col => col.name === 'bundle_selections_json');
        
        if (!hasBundleSelections) {
          console.log('📋 Migrating database: Adding transaction_items.bundle_selections_json column...');
          localDb.prepare('ALTER TABLE transaction_items ADD COLUMN bundle_selections_json TEXT').run();
        }
      } catch (e) {
        console.log('⚠️ Bundle feature migration check failed:', e);
      }
    
    try {
      // First block of SQL execution
      localDb.exec(`
        -- Core POS Tables
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password TEXT,
          name TEXT,
          googleId TEXT UNIQUE,
          createdAt TEXT,
          role_id INTEGER,
          organization_id INTEGER,
          updated_at INTEGER
        );

      
      CREATE TABLE IF NOT EXISTS businesses (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        permission_name TEXT UNIQUE NOT NULL,
        organization_id INTEGER,
        management_group_id INTEGER,
        image_url TEXT,
        created_at TEXT,
        updated_at INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY,
        business_id INTEGER,
        menu_code TEXT,
        nama TEXT NOT NULL,
        satuan TEXT NOT NULL,
        kategori TEXT NOT NULL,
        jenis TEXT,
        category2_id INTEGER,
        category2_name TEXT,
        keterangan TEXT,
        harga_beli REAL,
        ppn REAL,
        harga_jual INTEGER NOT NULL,
        harga_khusus REAL,
        harga_online REAL,
        harga_qpon REAL,
        harga_gofood REAL,
        harga_grabfood REAL,
        harga_shopeefood REAL,
        harga_tiktok REAL,
        fee_kerja REAL,
        status TEXT DEFAULT 'active',
        created_at TEXT,
        updated_at INTEGER,
        has_customization INTEGER DEFAULT 0,
        is_bundle INTEGER DEFAULT 0
      );
      
      -- Customization tables for offline support
      CREATE TABLE IF NOT EXISTS product_customization_types (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        selection_mode TEXT NOT NULL CHECK (selection_mode IN ('single', 'multiple')),
        display_order INTEGER DEFAULT 0,
        updated_at INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS product_customization_options (
        id INTEGER PRIMARY KEY,
        type_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        price_adjustment REAL DEFAULT 0.0,
        display_order INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        updated_at INTEGER,
        FOREIGN KEY (type_id) REFERENCES product_customization_types(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS bundle_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bundle_product_id INTEGER NOT NULL,
        category2_id INTEGER NOT NULL,
        required_quantity INTEGER NOT NULL DEFAULT 1,
        display_order INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at INTEGER,
        FOREIGN KEY (bundle_product_id) REFERENCES products(id) ON DELETE CASCADE,
        FOREIGN KEY (category2_id) REFERENCES category2(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS product_customizations (
        id INTEGER PRIMARY KEY,
        product_id INTEGER NOT NULL,
        customization_type_id INTEGER NOT NULL,
        updated_at INTEGER,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        FOREIGN KEY (customization_type_id) REFERENCES product_customization_types(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS ingredients (
        id INTEGER PRIMARY KEY,
        ingredient_code TEXT NOT NULL,
        nama TEXT NOT NULL,
        kategori TEXT NOT NULL,
        satuan_beli TEXT NOT NULL,
        isi_satuan_beli REAL NOT NULL,
        satuan_keluar TEXT NOT NULL,
        harga_beli INTEGER NOT NULL,
        stok_min INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        business_id INTEGER NOT NULL,
        created_at TEXT,
        updated_at INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS cogs (
        id INTEGER PRIMARY KEY,
        menu_code TEXT,
        ingredient_code TEXT,
        amount REAL NOT NULL DEFAULT 0.0,
        created_at TEXT,
        updated_at INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY,
        no_ktp TEXT UNIQUE,
        nama TEXT NOT NULL,
        phone_number TEXT,
        tgl_lahir TEXT,
        no_kk TEXT,
        created_at TEXT,
        updated_at INTEGER,
        is_active INTEGER DEFAULT 1,
        jenis_kelamin TEXT,
        kota TEXT,
        kecamatan TEXT,
        source_id INTEGER,
        pekerjaan_id INTEGER,
        source_lainnya TEXT,
        alamat TEXT,
        team_id INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS deals (
        id INTEGER PRIMARY KEY,
        contact_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        business_id INTEGER NOT NULL,
        activity_date TEXT NOT NULL,
        product_type TEXT NOT NULL,
        product_id INTEGER,
        motorcycle_product_id INTEGER,
        sales_pipeline_stage TEXT NOT NULL,
        financing_company TEXT,
        note TEXT,
        notes TEXT,
        created_at TEXT,
        updated_at INTEGER,
        team_id INTEGER,
        followup_count INTEGER DEFAULT 0
      );
      
      CREATE TABLE IF NOT EXISTS deal_products (
        id INTEGER PRIMARY KEY,
        deal_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER DEFAULT 1,
        unit_price REAL,
        total_price REAL,
        notes TEXT,
        created_at TEXT,
        updated_at INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS teams (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        organization_id INTEGER NOT NULL,
        team_lead_id INTEGER,
        business_id INTEGER,
        color TEXT DEFAULT '#3B82F6',
        is_active INTEGER DEFAULT 1,
        created_at TEXT,
        updated_at INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS roles (
        id INTEGER PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        organization_id INTEGER,
        created_at TEXT,
        updated_at INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS permissions (
        id INTEGER PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        created_at TEXT,
        category_id INTEGER,
        organization_id INTEGER,
        status TEXT DEFAULT 'active'
      );
      
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id INTEGER NOT NULL,
        permission_id INTEGER NOT NULL,
        PRIMARY KEY (role_id, permission_id)
      );
      
      -- Supporting Tables
      CREATE TABLE IF NOT EXISTS source (
        id INTEGER PRIMARY KEY,
        source_name TEXT UNIQUE NOT NULL,
        created_at TEXT,
        updated_at INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS pekerjaan (
        id INTEGER PRIMARY KEY,
        nama_pekerjaan TEXT UNIQUE NOT NULL,
        created_at TEXT,
        updated_at INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS kartu_keluarga (
        id INTEGER PRIMARY KEY,
        no_kk TEXT UNIQUE NOT NULL,
        created_at TEXT,
        updated_at INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS leasing_companies (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT,
        updated_at INTEGER
      );
      
      -- Core missing tables for full offline support
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,  -- UUID instead of INTEGER
        business_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        shift_uuid TEXT, -- Link to specific shift (UUID)
        payment_method TEXT NOT NULL,
        pickup_method TEXT NOT NULL,
        total_amount REAL NOT NULL,
        voucher_discount REAL DEFAULT 0.0,
        voucher_type TEXT DEFAULT 'none',
        voucher_value REAL,
        voucher_label TEXT,
        final_amount REAL NOT NULL,
        amount_received REAL NOT NULL,
        change_amount REAL DEFAULT 0.0,
        status TEXT DEFAULT 'completed',
        refund_status TEXT DEFAULT 'none',
        refund_total REAL DEFAULT 0.0,
        last_refunded_at TEXT,
        created_at TEXT NOT NULL,
        updated_at INTEGER,
        synced_at INTEGER,
        contact_id INTEGER,
        customer_name TEXT,
        customer_unit INTEGER,
        note TEXT,
        bank_name TEXT,
        card_number TEXT,
        cl_account_id INTEGER,
        cl_account_name TEXT,
        bank_id INTEGER,
        receipt_number INTEGER,
        transaction_type TEXT DEFAULT 'drinks',
        payment_method_id INTEGER NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS transaction_items (
        id TEXT PRIMARY KEY,  -- UUID instead of INTEGER
        transaction_id TEXT NOT NULL,  -- References transaction UUID
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price REAL NOT NULL,
        total_price REAL NOT NULL,
        custom_note TEXT,
        bundle_selections_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
      );
      
      -- Normalized customization tables for analytics
      CREATE TABLE IF NOT EXISTS transaction_item_customizations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_item_id TEXT NOT NULL,  -- UUID reference to transaction_items.id
        customization_type_id INTEGER NOT NULL,
        bundle_product_id INTEGER DEFAULT NULL,  -- NULL = main product, otherwise ID of bundle product
        created_at TEXT NOT NULL,
        FOREIGN KEY (customization_type_id) REFERENCES product_customization_types(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS transaction_item_customization_options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_item_customization_id INTEGER NOT NULL,
        customization_option_id INTEGER NOT NULL,
        option_name TEXT NOT NULL,  -- Snapshot of option name at time of sale
        price_adjustment REAL NOT NULL DEFAULT 0.0,  -- Snapshot of price adjustment at time of sale
        created_at TEXT NOT NULL,
        FOREIGN KEY (transaction_item_customization_id) REFERENCES transaction_item_customizations(id) ON DELETE CASCADE,
        FOREIGN KEY (customization_option_id) REFERENCES product_customization_options(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS transaction_refunds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid_id TEXT UNIQUE NOT NULL,
        transaction_uuid TEXT NOT NULL,
        business_id INTEGER NOT NULL,
        shift_uuid TEXT,
        refunded_by INTEGER NOT NULL,
        refund_amount REAL NOT NULL,
        cash_delta REAL NOT NULL DEFAULT 0.0,
        payment_method_id INTEGER NOT NULL,
        reason TEXT,
        note TEXT,
        refund_type TEXT DEFAULT 'full',
        status TEXT DEFAULT 'completed',
        refunded_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at INTEGER,
        synced_at INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS payment_methods (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        description TEXT,
        is_active INTEGER DEFAULT 1,
        requires_additional_info INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS banks (
        id INTEGER PRIMARY KEY,
        bank_code TEXT UNIQUE NOT NULL,
        bank_name TEXT NOT NULL,
        is_popular INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at TEXT
      );
      
      CREATE TABLE IF NOT EXISTS organizations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        owner_user_id INTEGER NOT NULL,
        subscription_status TEXT DEFAULT 'trial',
        subscription_plan TEXT DEFAULT 'basic',
        trial_ends_at TEXT,
        created_at TEXT,
        updated_at INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS management_groups (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        permission_name TEXT NOT NULL,
        description TEXT,
        organization_id INTEGER NOT NULL,
        manager_user_id INTEGER,
        created_at TEXT,
        updated_at INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS category1 (
        id INTEGER PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        display_order INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at TEXT,
        updated_at INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS category2 (
        id INTEGER PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        business_id INTEGER,
        description TEXT,
        display_order INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at TEXT,
        updated_at INTEGER,
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS cl_accounts (
        id INTEGER PRIMARY KEY,
        account_code TEXT UNIQUE NOT NULL,
        account_name TEXT NOT NULL,
        contact_info TEXT,
        credit_limit REAL DEFAULT 0.0,
        current_balance REAL DEFAULT 0.0,
        is_active INTEGER DEFAULT 1,
        created_at TEXT,
        updated_at INTEGER
      );
      
      -- Shifts table for cashier shift tracking
      CREATE TABLE IF NOT EXISTS shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid_id TEXT UNIQUE NOT NULL,
        business_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        user_name TEXT NOT NULL,
        shift_start TEXT NOT NULL,
        shift_end TEXT,
        modal_awal REAL NOT NULL DEFAULT 0.0,
        kas_akhir REAL,
        kas_expected REAL,
        kas_selisih REAL,
        kas_selisih_label TEXT DEFAULT 'balanced',
        cash_sales_total REAL,
        cash_refund_total REAL,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
        created_at TEXT NOT NULL,
        updated_at INTEGER,
        synced_at INTEGER,
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      
      -- Legacy tables for backward compatibility
      CREATE TABLE IF NOT EXISTS categories (
        category2_name TEXT PRIMARY KEY,
        updated_at INTEGER
      );
      
      -- Sync status tracking
      CREATE TABLE IF NOT EXISTS sync_status (
        key TEXT PRIMARY KEY,
        last_sync INTEGER,
        status TEXT
      );
      
      -- Printer configurations
      CREATE TABLE IF NOT EXISTS printer_configs (
        id TEXT PRIMARY KEY,
        printer_type TEXT NOT NULL,
        system_printer_name TEXT NOT NULL,
        extra_settings TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );
      
      -- Printer mode settings
      CREATE TABLE IF NOT EXISTS printer_mode_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        printer_type TEXT UNIQUE NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('auto', 'manual')),
        created_at INTEGER,
        updated_at INTEGER
      );
      
      -- Daily printer counters (reset daily)
      CREATE TABLE IF NOT EXISTS printer_daily_counters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        printer_type TEXT NOT NULL,
        business_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        counter INTEGER DEFAULT 0,
        last_reset_at INTEGER,
        UNIQUE(printer_type, business_id, date)
      );
      
      -- Printer 2 automation tracking (for auto mode)
      CREATE TABLE IF NOT EXISTS printer2_automation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_id INTEGER NOT NULL,
        cycle_number INTEGER NOT NULL,
        selected_transactions TEXT NOT NULL,
        created_at INTEGER,
        UNIQUE(business_id, cycle_number)
      );
      
      -- Printer 2 audit log
      CREATE TABLE IF NOT EXISTS printer2_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id TEXT NOT NULL,
        printer2_receipt_number INTEGER NOT NULL,
        print_mode TEXT NOT NULL CHECK (print_mode IN ('auto', 'manual')),
        cycle_number INTEGER,
        global_counter INTEGER,
        printed_at TEXT NOT NULL,
        printed_at_epoch INTEGER NOT NULL,
        synced_at INTEGER,
        FOREIGN KEY (transaction_id) REFERENCES transactions(id)
      );
      `);

      // Add shift_uuid column to transactions table if it doesn't exist
      try {
        const tableInfo = localDb.prepare("PRAGMA table_info(transactions)").all() as any[];
        const hasShiftUuid = tableInfo.some(col => col.name === 'shift_uuid');
        
        if (!hasShiftUuid) {
          console.log('Adding shift_uuid column to transactions table...');
          localDb.prepare("ALTER TABLE transactions ADD COLUMN shift_uuid TEXT").run();
          // Add index for shift_uuid
          localDb.prepare("CREATE INDEX IF NOT EXISTS idx_transactions_shift ON transactions(shift_uuid)").run();
        }
      } catch (error) {
        console.error('Error checking/adding shift_uuid column:', error);
      }

      localDb.exec(`
      -- Printer 1 audit log (local)
      CREATE TABLE IF NOT EXISTS printer1_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id TEXT NOT NULL,
        printer1_receipt_number INTEGER NOT NULL,
        global_counter INTEGER,
        printed_at TEXT NOT NULL,
        printed_at_epoch INTEGER NOT NULL,
        synced_at INTEGER,
        FOREIGN KEY (transaction_id) REFERENCES transactions(id)
      );
      
      -- UUID sequence tracker for numeric UUID generation
      CREATE TABLE IF NOT EXISTS uuid_sequence_tracker (
        key TEXT PRIMARY KEY,
        counter INTEGER DEFAULT 0,
        created_at INTEGER,
        updated_at INTEGER
      );
      
      -- Indexes for performance
      CREATE INDEX IF NOT EXISTS idx_products_jenis ON products(jenis);
      CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
      CREATE INDEX IF NOT EXISTS idx_products_business ON products(business_id);
      CREATE INDEX IF NOT EXISTS idx_ingredients_business ON ingredients(business_id);
      CREATE INDEX IF NOT EXISTS idx_contacts_team ON contacts(team_id);
      CREATE INDEX IF NOT EXISTS idx_deals_contact ON deals(contact_id);
      CREATE INDEX IF NOT EXISTS idx_deals_user ON deals(user_id);
      CREATE INDEX IF NOT EXISTS idx_deals_business ON deals(business_id);
      CREATE INDEX IF NOT EXISTS idx_deal_products_deal ON deal_products(deal_id);
      CREATE INDEX IF NOT EXISTS idx_users_organization ON users(organization_id);
      CREATE INDEX IF NOT EXISTS idx_teams_organization ON teams(organization_id);
      
      -- Indexes for new tables
      CREATE INDEX IF NOT EXISTS idx_transactions_business ON transactions(business_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(created_at);
      CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
      CREATE INDEX IF NOT EXISTS idx_transactions_contact ON transactions(contact_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_cl_account ON transactions(cl_account_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_bank ON transactions(bank_name);
      CREATE INDEX IF NOT EXISTS idx_transactions_bank_id ON transactions(bank_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_receipt_number ON transactions(receipt_number);
      CREATE INDEX IF NOT EXISTS idx_transactions_transaction_type ON transactions(transaction_type);
      CREATE INDEX IF NOT EXISTS idx_transactions_daily_receipt ON transactions(business_id, created_at, receipt_number);
      CREATE INDEX IF NOT EXISTS idx_transactions_payment_method ON transactions(payment_method_id);
      
      CREATE INDEX IF NOT EXISTS idx_transaction_items_transaction ON transaction_items(transaction_id);
      CREATE INDEX IF NOT EXISTS idx_transaction_items_product ON transaction_items(product_id);
      CREATE INDEX IF NOT EXISTS idx_transaction_items_created ON transaction_items(created_at);
      
      -- Indexes for normalized customization tables
      CREATE INDEX IF NOT EXISTS idx_tic_transaction_item ON transaction_item_customizations(transaction_item_id);
      CREATE INDEX IF NOT EXISTS idx_tic_customization_type ON transaction_item_customizations(customization_type_id);
      CREATE INDEX IF NOT EXISTS idx_tic_bundle_product ON transaction_item_customizations(bundle_product_id);
      CREATE INDEX IF NOT EXISTS idx_tic_item_type ON transaction_item_customizations(transaction_item_id, customization_type_id);
      CREATE INDEX IF NOT EXISTS idx_tic_item_bundle ON transaction_item_customizations(transaction_item_id, bundle_product_id);
      
      CREATE INDEX IF NOT EXISTS idx_tico_transaction_item_customization ON transaction_item_customization_options(transaction_item_customization_id);
      CREATE INDEX IF NOT EXISTS idx_tico_customization_option ON transaction_item_customization_options(customization_option_id);
      CREATE INDEX IF NOT EXISTS idx_tico_customization_option_composite ON transaction_item_customization_options(transaction_item_customization_id, customization_option_id);
      
      CREATE INDEX IF NOT EXISTS idx_printer_mode_settings_type ON printer_mode_settings(printer_type);
      CREATE INDEX IF NOT EXISTS idx_printer_daily_counters_lookup ON printer_daily_counters(printer_type, business_id, date);
      CREATE INDEX IF NOT EXISTS idx_printer2_automation_lookup ON printer2_automation(business_id, cycle_number);
      CREATE INDEX IF NOT EXISTS idx_printer2_audit_transaction ON printer2_audit_log(transaction_id);
      CREATE INDEX IF NOT EXISTS idx_printer2_audit_mode ON printer2_audit_log(print_mode);
      CREATE INDEX IF NOT EXISTS idx_printer2_audit_date ON printer2_audit_log(printed_at_epoch);
      
      CREATE INDEX IF NOT EXISTS idx_printer1_audit_transaction ON printer1_audit_log(transaction_id);
      CREATE INDEX IF NOT EXISTS idx_printer1_audit_date ON printer1_audit_log(printed_at_epoch);
      
      CREATE INDEX IF NOT EXISTS idx_payment_methods_code ON payment_methods(code);
      CREATE INDEX IF NOT EXISTS idx_payment_methods_active ON payment_methods(is_active);
      
      CREATE INDEX IF NOT EXISTS idx_banks_code ON banks(bank_code);
      CREATE INDEX IF NOT EXISTS idx_banks_active ON banks(is_active);
      CREATE INDEX IF NOT EXISTS idx_banks_popular ON banks(is_popular);
      
      CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
      CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations(owner_user_id);
      
      CREATE INDEX IF NOT EXISTS idx_management_groups_organization ON management_groups(organization_id);
      CREATE INDEX IF NOT EXISTS idx_management_groups_manager ON management_groups(manager_user_id);
      
      CREATE INDEX IF NOT EXISTS idx_category1_active ON category1(is_active);
      CREATE INDEX IF NOT EXISTS idx_category1_display_order ON category1(display_order);
      
      CREATE INDEX IF NOT EXISTS idx_category2_active ON category2(is_active);
      CREATE INDEX IF NOT EXISTS idx_category2_display_order ON category2(display_order);
      CREATE INDEX IF NOT EXISTS idx_category2_business_id ON category2(business_id);
      
      CREATE INDEX IF NOT EXISTS idx_cl_accounts_code ON cl_accounts(account_code);
      CREATE INDEX IF NOT EXISTS idx_cl_accounts_active ON cl_accounts(is_active);
      
      
      -- Offline transaction queue for sync when online
      CREATE TABLE IF NOT EXISTS offline_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        sync_status TEXT DEFAULT 'pending',
        sync_attempts INTEGER DEFAULT 0,
        last_sync_attempt INTEGER
      );
      
      -- Offline transaction items queue
      CREATE TABLE IF NOT EXISTS offline_transaction_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        offline_transaction_id INTEGER NOT NULL,
        item_data TEXT NOT NULL,
        FOREIGN KEY (offline_transaction_id) REFERENCES offline_transactions(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS offline_refunds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        refund_data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        sync_status TEXT DEFAULT 'pending',
        sync_attempts INTEGER DEFAULT 0,
        last_sync_attempt INTEGER
      );
      
      -- Indexes for offline sync performance
      CREATE INDEX IF NOT EXISTS idx_offline_transactions_sync ON offline_transactions(sync_status);
      CREATE INDEX IF NOT EXISTS idx_offline_transactions_created ON offline_transactions(created_at);
    `);
    
    console.log('✅ SQLite database initialized successfully');
    console.log('📊 Database file location:', dbPath);
    
    // Initialize printer management service
    if (localDb) {
      printerService = new PrinterManagementService(localDb);
      console.log('✅ Printer Management Service initialized');
    }
    
    // Migrate slideshow images from /public/ to userData on first run
    try {
      const slideshowPath = getSlideshowPath();
      const publicSlideshowPath = path.join(process.cwd(), 'public', 'images', 'slideshow');
      
      if (fs.existsSync(publicSlideshowPath)) {
        const existingFiles = fs.readdirSync(slideshowPath);
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        const existingImages = existingFiles.filter(file => {
          const ext = path.extname(file).toLowerCase();
          return imageExtensions.includes(ext);
        });
        
        if (existingImages.length === 0) {
          const publicFiles = fs.readdirSync(publicSlideshowPath);
          const imagesToMigrate = publicFiles.filter(file => {
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
    
    console.log('🔍 Testing database connection...');
    
    // Test the database connection
    try {
      const testResult = localDb.prepare('SELECT 1 as test').get();
      console.log('✅ Database test query successful:', testResult);
    } catch (testError) {
      console.error('❌ Database test query failed:', testError);
    }
    
    // Schema migration: Add missing columns to existing tables
    try {
      console.log('🔍 Running schema migrations...');
      
      // Ensure printer_configs.extra_settings column exists for per-printer settings
      const printerConfigSchema = localDb.prepare(`PRAGMA table_info(printer_configs)`).all() as TableInfoRow[];
      const hasExtraSettingsColumn = printerConfigSchema.some(col => col.name === 'extra_settings');
      if (!hasExtraSettingsColumn) {
        console.log('📝 Adding extra_settings column to printer_configs...');
        localDb.prepare('ALTER TABLE printer_configs ADD COLUMN extra_settings TEXT').run();
      }
      
      // Check if display_order column exists in product_customization_types
      const columnsResult = localDb.prepare(`
        SELECT sql FROM sqlite_master WHERE type='table' AND name='product_customization_types'
      `).get() as { sql?: string } | undefined;
      
      if (columnsResult && columnsResult.sql && !columnsResult.sql.includes('display_order')) {
        console.log('📝 Adding display_order to product_customization_types...');
        localDb.prepare('ALTER TABLE product_customization_types ADD COLUMN display_order INTEGER DEFAULT 0').run();
      }
      
      // Check if display_order and status columns exist in product_customization_options
      const optionsColumnsResult = localDb.prepare(`
        SELECT sql FROM sqlite_master WHERE type='table' AND name='product_customization_options'
      `).get() as { sql?: string } | undefined;
      
      if (optionsColumnsResult && optionsColumnsResult.sql && !optionsColumnsResult.sql.includes('display_order')) {
        console.log('📝 Adding display_order to product_customization_options...');
        localDb.prepare('ALTER TABLE product_customization_options ADD COLUMN display_order INTEGER DEFAULT 0').run();
      }
      
      if (optionsColumnsResult && optionsColumnsResult.sql && !optionsColumnsResult.sql.includes('status')) {
        console.log('📝 Adding status to product_customization_options...');
        localDb.prepare('ALTER TABLE product_customization_options ADD COLUMN status TEXT DEFAULT \'active\' CHECK (status IN (\'active\', \'inactive\'))').run();
      }
      
      console.log('✅ Schema migrations completed');
    } catch (migrationError) {
      console.error('⚠️ Schema migration error (this is OK for first run):', migrationError);
    }
  } catch (dbExecError) {
    console.error('❌ Database execution error:', dbExecError);
    throw dbExecError;
  }
  } catch (error) {
    console.error('❌ Failed to initialize SQLite:', error);
    localDb = null;
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

  // Create main POS window (cashier display)
  // Start with login size (800x432), will be resized after successful login
  mainWindow = new BrowserWindow({
    width: 800,
    height: 432,
    center: true,
    minWidth: 800,
    minHeight: 432,
    title: 'Marviano POS - Login',
    frame: false,
    backgroundColor: '#111827',
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
      title: 'Marviano POS - Customer Display',
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
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: { category2_name: string; updated_at?: number }[]) => {
      const stmt = localDb!.prepare('INSERT INTO categories (category2_name, updated_at) VALUES (?, ?) ON CONFLICT(category2_name) DO UPDATE SET updated_at=excluded.updated_at');
      for (const r of data) {
        stmt.run(r.category2_name, r.updated_at || Date.now());
      }
    });
    tx(rows);
    return { success: true };
  });
  ipcMain.handle('localdb-get-categories', async () => {
    if (!localDb) return [];
    const stmt = localDb.prepare('SELECT category2_name, updated_at FROM categories ORDER BY category2_name ASC');
    return stmt.all();
  });
  ipcMain.handle('localdb-upsert-products', async (event, rows: RowArray) => {
    if (!localDb) return { success: false };
    
    console.log(`🔄 [PRODUCTS UPSERT] Received ${rows.length} products to upsert`);
    
    const tx = localDb.transaction((data: RowArray) => {
      const stmt = localDb!.prepare(`INSERT INTO products (
        id, business_id, menu_code, nama, satuan, kategori, jenis, category2_id, category2_name, keterangan,
        harga_beli, ppn, harga_jual, harga_khusus, harga_online, harga_qpon, harga_gofood, harga_grabfood, harga_shopeefood, harga_tiktok, fee_kerja, status, is_bundle, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        business_id=excluded.business_id,
        menu_code=excluded.menu_code,
        nama=excluded.nama,
        satuan=excluded.satuan,
        kategori=excluded.kategori,
        jenis=excluded.jenis,
        category2_id=excluded.category2_id,
        category2_name=excluded.category2_name,
        keterangan=excluded.keterangan,
        harga_beli=excluded.harga_beli,
        ppn=excluded.ppn,
        harga_jual=excluded.harga_jual,
        harga_khusus=excluded.harga_khusus,
        harga_online=excluded.harga_online,
        harga_qpon=excluded.harga_qpon,
        harga_gofood=excluded.harga_gofood,
        harga_grabfood=excluded.harga_grabfood,
        harga_shopeefood=excluded.harga_shopeefood,
        harga_tiktok=excluded.harga_tiktok,
        fee_kerja=excluded.fee_kerja,
        status=excluded.status,
        is_bundle=excluded.is_bundle,
        updated_at=excluded.updated_at`);
        
      let successCount = 0;
      let errorCount = 0;
      
      for (const r of data) {
        try {
          // Map MySQL columns to SQLite columns
          const kategori = r.kategori || r.category1_name || '';
          let category2Id = r.category2_id ? Number(r.category2_id) : null;
          const category2Name = r.category2_name || r.jenis || '';
          
          // If category2_id is missing but category2_name exists, try to look it up from category2 table
          if (!category2Id && category2Name && localDb) {
            try {
              const lookupStmt = localDb.prepare('SELECT id FROM category2 WHERE name = ? LIMIT 1');
              const category2Lookup = lookupStmt.get(category2Name) as { id: number } | undefined;
              if (category2Lookup) {
                category2Id = category2Lookup.id;
                console.log(`✅ [PRODUCTS UPSERT] Looked up category2_id ${category2Id} for category2_name "${category2Name}"`);
              }
            } catch (lookupError) {
              console.warn(`⚠️ [PRODUCTS UPSERT] Failed to lookup category2_id for "${category2Name}":`, lookupError);
            }
          }
          
          const isBundle = r.is_bundle === 1 || r.is_bundle === true ? 1 : 0;
          
          stmt.run(
            r.id, r.business_id, r.menu_code, r.nama, r.satuan || '', kategori, null, category2Id, category2Name, r.keterangan || null,
            r.harga_beli || null, r.ppn || null, r.harga_jual, r.harga_khusus || null, 
            r.harga_online || null, r.harga_qpon || null, r.harga_gofood || null, r.harga_grabfood || null, r.harga_shopeefood || null, r.harga_tiktok || null,
            r.fee_kerja || null, r.status, isBundle, Date.now()
          );
          successCount++;
        } catch (error) {
          errorCount++;
          console.warn(`⚠️ [PRODUCTS UPSERT] Skipping product ${r.id} (${r.nama}) due to error:`, error);
        }
      }
      console.log(`✅ [PRODUCTS UPSERT] Completed: ${successCount} success, ${errorCount} errors`);
    });
    
    try {
      tx(rows);
      return { success: true };
    } catch (error) {
      console.error('❌ [PRODUCTS UPSERT] Transaction failed:', error);
      return { success: false };
    }
  });
  ipcMain.handle('localdb-get-products-by-jenis', async (event, jenis: string) => {
    if (!localDb) return [];
    const stmt = localDb.prepare(`SELECT 
      id, business_id, menu_code, nama, satuan, kategori, category2_name, keterangan,
      harga_beli, ppn, harga_jual, harga_khusus, harga_online, harga_qpon, harga_gofood, harga_grabfood, harga_shopeefood, harga_tiktok, fee_kerja, status, is_bundle
      FROM products WHERE category2_name = ? AND status = 'active' ORDER BY nama ASC`);
    return stmt.all(jenis);
  });
  
  // Add the missing method for category2 filtering
  ipcMain.handle('localdb-get-products-by-category2', async (event, category2Name: string) => {
    if (!localDb) return [];
    const stmt = localDb.prepare(`SELECT 
      id, business_id, menu_code, nama, satuan, kategori, category2_name, keterangan,
      harga_beli, ppn, harga_jual, harga_khusus, harga_online, harga_qpon, harga_gofood, harga_grabfood, harga_shopeefood, harga_tiktok, fee_kerja, status, is_bundle
      FROM products WHERE category2_name = ? AND status = 'active' ORDER BY nama ASC`);
    return stmt.all(category2Name);
  });
  ipcMain.handle('localdb-get-all-products', async () => {
    if (!localDb) return [];
    try {
          const stmt = localDb.prepare(`SELECT 
        id, business_id, menu_code, nama, satuan, kategori, category2_name, keterangan,
        harga_beli, ppn, harga_jual, harga_khusus, harga_online, harga_qpon, harga_gofood, harga_grabfood, harga_shopeefood, harga_tiktok, fee_kerja, status, is_bundle
        FROM products WHERE status = 'active' ORDER BY nama ASC`);
    return stmt.all();
    } catch (error) {
      console.error('Error getting all products:', error);
      return [];
    }
  });
  
  // Customization handlers
  ipcMain.handle('localdb-upsert-customization-types', async (event, rows: RowArray) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: RowArray) => {
      const stmt = localDb!.prepare(`INSERT INTO product_customization_types (
        id, name, selection_mode, display_order, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, selection_mode=excluded.selection_mode,
        display_order=excluded.display_order, updated_at=excluded.updated_at`);
      for (const r of data) {
        stmt.run(r.id, r.name, r.selection_mode, r.display_order || 0, Date.now());
      }
    });
    tx(rows);
    return { success: true };
  });
  
  ipcMain.handle('localdb-upsert-customization-options', async (event, rows: RowArray) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: RowArray) => {
      const stmt = localDb!.prepare(`INSERT INTO product_customization_options (
        id, type_id, name, price_adjustment, display_order, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type_id=excluded.type_id, name=excluded.name, price_adjustment=excluded.price_adjustment,
        display_order=excluded.display_order, status=excluded.status, updated_at=excluded.updated_at`);
      for (const r of data) {
        stmt.run(r.id, r.type_id, r.name, r.price_adjustment || 0.0, r.display_order || 0, r.status || 'active', Date.now());
      }
    });
    tx(rows);
    return { success: true };
  });
  
  ipcMain.handle('localdb-upsert-product-customizations', async (event, rows: RowArray) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: RowArray) => {
      const stmt = localDb!.prepare(`INSERT INTO product_customizations (
        id, product_id, customization_type_id, updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        product_id=excluded.product_id, customization_type_id=excluded.customization_type_id,
        updated_at=excluded.updated_at`);
      for (const r of data) {
        try {
          stmt.run(r.id, r.product_id, r.customization_type_id, Date.now());
        } catch (error) {
          console.warn(`⚠️ [PRODUCT CUSTOMIZATION UPSERT] Skipping row ${r.id} due to error:`, error);
        }
      }
    });
    tx(rows);
    return { success: true };
  });
  
  // Bundle items handlers
  ipcMain.handle('localdb-get-bundle-items', async (event, productId: number | string) => {
    if (!localDb) {
      console.warn('⚠️ [BUNDLE ITEMS] Local DB not available');
      return [];
    }
    try {
      // Ensure productId is a number
      const productIdNum = typeof productId === 'string' ? parseInt(productId, 10) : productId;
      if (isNaN(productIdNum)) {
        console.error(`❌ [BUNDLE ITEMS] Invalid product ID: ${productId}`);
        return [];
      }
      
      console.log(`🔍 [BUNDLE ITEMS] Fetching bundle items for product ID: ${productIdNum} (type: ${typeof productId}, converted from: ${productId})`);
      
      // First, check if any bundle items exist at all
      const allBundleItems = localDb.prepare('SELECT bundle_product_id, COUNT(*) as count FROM bundle_items GROUP BY bundle_product_id').all() as Array<{ bundle_product_id: number; count: number }>;
      console.log(`📊 [BUNDLE ITEMS] Bundle items by product:`, allBundleItems);
      
      const bundleItems = localDb.prepare(`
        SELECT 
          bi.id,
          bi.bundle_product_id,
          bi.category2_id,
          bi.required_quantity,
          bi.display_order,
          c2.name AS category2_name
        FROM bundle_items bi
        LEFT JOIN category2 c2 ON bi.category2_id = c2.id
        WHERE bi.bundle_product_id = ?
        ORDER BY bi.display_order ASC
      `).all(productIdNum) as BundleItemRow[];
      
      console.log(`✅ [BUNDLE ITEMS] Found ${bundleItems.length} bundle items for product ${productIdNum}`);
      if (bundleItems.length > 0) {
        console.log(`📦 [BUNDLE ITEMS] First item:`, JSON.stringify(bundleItems[0], null, 2));
      } else {
        console.warn(`⚠️ [BUNDLE ITEMS] No bundle items found for product ${productIdNum}. Checking if product exists in products table...`);
        const productCheck = localDb.prepare('SELECT id, nama, is_bundle FROM products WHERE id = ?').get(productIdNum);
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
    if (!localDb) {
      console.warn('⚠️ [BUNDLE ITEMS UPSERT] Local DB not available');
      return { success: false };
    }
    try {
      if (!Array.isArray(rows)) {
        console.error(`❌ [BUNDLE ITEMS UPSERT] Invalid data: rows is not an array, got ${typeof rows}`);
        return { success: false };
      }
      
      console.log(`🔄 [BUNDLE ITEMS UPSERT] Upserting ${rows.length} bundle items`);
      if (rows.length > 0) {
        console.log(`📦 [BUNDLE ITEMS UPSERT] First item sample:`, JSON.stringify(rows[0], null, 2));
      }
      
      const tx = localDb.transaction((data: RowArray) => {
        const stmt = localDb!.prepare(`
          INSERT INTO bundle_items (
            id, bundle_product_id, category2_id, required_quantity, display_order, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            bundle_product_id = excluded.bundle_product_id,
            category2_id = excluded.category2_id,
            required_quantity = excluded.required_quantity,
            display_order = excluded.display_order,
            updated_at = excluded.updated_at
        `);
        let successCount = 0;
        let errorCount = 0;
        for (const r of data) {
          try {
            const createdAt = r.created_at || new Date().toISOString();
            const updatedAt = Date.now();
            stmt.run(
              r.id,
              r.bundle_product_id,
              r.category2_id,
              r.required_quantity,
              r.display_order,
              createdAt,
              updatedAt
            );
            successCount++;
          } catch (rowError: unknown) {
            errorCount++;
            // Simply log warning and continue, instead of error which scares users
            const rowErrorMessage = (rowError && typeof rowError === 'object' && 'message' in rowError)
              ? String((rowError as { message: unknown }).message)
              : String(rowError);
            console.warn(`⚠️ [BUNDLE ITEMS UPSERT] Skipping row ${r.id}: ${rowErrorMessage}`);
          }
        }
        console.log(`📊 [BUNDLE ITEMS UPSERT] Upserted ${successCount} items, ${errorCount} errors`);
      });
      tx(rows);
      console.log(`✅ [BUNDLE ITEMS UPSERT] Successfully upserted bundle items`);
      
      // Verify the data was saved
      const verifyCount = localDb.prepare('SELECT COUNT(*) as count FROM bundle_items').get() as { count: number };
      console.log(`✅ [BUNDLE ITEMS UPSERT] Total bundle items in database: ${verifyCount.count}`);
      
      return { success: true };
    } catch (error: unknown) {
      const errorMessage = (error && typeof error === 'object' && 'message' in error)
        ? String((error as { message: unknown }).message)
        : String(error);
      console.error(`❌ [BUNDLE ITEMS UPSERT] Error:`, errorMessage);
      return { success: false };
    }
  });

  // Debug handler to list all bundle items
  ipcMain.handle('localdb-debug-bundle-items', async () => {
    if (!localDb) return { success: false, items: [] };
    try {
      const allItems = localDb.prepare(`
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
      `).all() as BundleItemRow[];
      
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
    if (!localDb) return [];
    try {
      console.log(`🔍 [OFFLINE] Fetching customizations for product ${productId}`);
      
      // Get customization types for this product
      const typesStmt = localDb.prepare(`
        SELECT DISTINCT ct.id, ct.name, ct.selection_mode, ct.display_order
        FROM product_customization_types ct
        INNER JOIN product_customizations pc ON ct.id = pc.customization_type_id
        WHERE pc.product_id = ?
        ORDER BY ct.display_order ASC, ct.name ASC
      `);
      const types = typesStmt.all(productId) as CustomizationTypeRow[];
      console.log(`📋 [OFFLINE] Found ${types.length} customization types for product ${productId}`, types);
      
      // For each type, get all available options (not just for this product)
      const customizations = types.map((type) => {
        const optionsStmt = localDb!.prepare(`
          SELECT co.id, co.type_id, co.name, co.price_adjustment, co.display_order
          FROM product_customization_options co
          WHERE co.type_id = ? AND co.status = 'active'
          ORDER BY co.display_order ASC, co.name ASC
        `);
        const options = optionsStmt.all(type.id) as CustomizationOptionRow[];
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
      });
      
      console.log(`✅ [OFFLINE] Returning ${customizations.length} customizations:`, customizations);
      return customizations;
    } catch (error) {
      console.error('❌ Error getting product customizations:', error);
      return [];
    }
  });
  
  ipcMain.handle('localdb-update-sync-status', async (event, key: string, status: string) => {
    if (!localDb) return { success: false };
    const stmt = localDb.prepare('INSERT INTO sync_status (key, last_sync, status) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET last_sync=excluded.last_sync, status=excluded.status');
    stmt.run(key, Date.now(), status);
    return { success: true };
  });
  ipcMain.handle('localdb-get-sync-status', async (event, key: string) => {
    if (!localDb) return null;
    const stmt = localDb.prepare('SELECT * FROM sync_status WHERE key = ?');
    return stmt.get(key);
  });

  // Comprehensive IPC handlers for all POS tables
  // Users
  ipcMain.handle('localdb-upsert-users', async (event, rows: RowArray) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: RowArray) => {
      const stmt = localDb!.prepare(`INSERT INTO users (
        id, email, password, name, googleId, createdAt, role_id, organization_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        email=excluded.email, password=excluded.password, name=excluded.name,
        googleId=excluded.googleId, createdAt=excluded.createdAt, role_id=excluded.role_id,
        organization_id=excluded.organization_id, updated_at=excluded.updated_at`);
      for (const r of data) {
        stmt.run(r.id, r.email, r.password, r.name, r.googleId, r.createdAt, r.role_id, r.organization_id, Date.now());
      }
    });
    tx(rows);
    return { success: true };
  });
  
  ipcMain.handle('localdb-get-users', async () => {
    if (!localDb) return [];
    const stmt = localDb.prepare('SELECT * FROM users ORDER BY name ASC');
    return stmt.all();
  });

  // Businesses
  ipcMain.handle('localdb-upsert-businesses', async (event, rows: RowArray) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: RowArray) => {
      const stmt = localDb!.prepare(`INSERT INTO businesses (
        id, name, permission_name, organization_id, management_group_id, image_url, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, permission_name=excluded.permission_name, organization_id=excluded.organization_id,
        management_group_id=excluded.management_group_id, image_url=excluded.image_url,
        created_at=excluded.created_at, updated_at=excluded.updated_at`);
      for (const r of data) {
        stmt.run(r.id, r.name, r.permission_name, r.organization_id, r.management_group_id, r.image_url, r.created_at, Date.now());
      }
    });
    tx(rows);
    return { success: true };
  });

  ipcMain.handle('localdb-get-businesses', async () => {
    if (!localDb) return [];
    const stmt = localDb.prepare('SELECT * FROM businesses ORDER BY name ASC');
    return stmt.all();
  });

  // Ingredients
  ipcMain.handle('localdb-upsert-ingredients', async (event, rows: RowArray) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: RowArray) => {
      const stmt = localDb!.prepare(`INSERT INTO ingredients (
        id, ingredient_code, nama, kategori, satuan_beli, isi_satuan_beli, satuan_keluar,
        harga_beli, stok_min, status, business_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        ingredient_code=excluded.ingredient_code, nama=excluded.nama, kategori=excluded.kategori,
        satuan_beli=excluded.satuan_beli, isi_satuan_beli=excluded.isi_satuan_beli, satuan_keluar=excluded.satuan_keluar,
        harga_beli=excluded.harga_beli, stok_min=excluded.stok_min, status=excluded.status,
        business_id=excluded.business_id, created_at=excluded.created_at, updated_at=excluded.updated_at`);
      for (const r of data) {
        stmt.run(r.id, r.ingredient_code, r.nama, r.kategori, r.satuan_beli, r.isi_satuan_beli, r.satuan_keluar,
                r.harga_beli, r.stok_min, r.status, r.business_id, r.created_at, Date.now());
      }
    });
    tx(rows);
    return { success: true };
  });

  ipcMain.handle('localdb-get-ingredients', async (event, businessId?: number) => {
    if (!localDb) return [];
    if (businessId) {
      const stmt = localDb.prepare('SELECT * FROM ingredients WHERE business_id = ? AND status = \'active\' ORDER BY nama ASC');
      return stmt.all(businessId);
    } else {
      const stmt = localDb.prepare('SELECT * FROM ingredients WHERE status = \'active\' ORDER BY nama ASC');
      return stmt.all();
    }
  });

  // COGS
  ipcMain.handle('localdb-upsert-cogs', async (event, rows: RowArray) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: RowArray) => {
      const stmt = localDb!.prepare(`INSERT INTO cogs (
        id, menu_code, ingredient_code, amount, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        menu_code=excluded.menu_code, ingredient_code=excluded.ingredient_code,
        amount=excluded.amount, created_at=excluded.created_at, updated_at=excluded.updated_at`);
      for (const r of data) {
        stmt.run(r.id, r.menu_code, r.ingredient_code, r.amount, r.created_at, Date.now());
      }
    });
    tx(rows);
    return { success: true };
  });

  ipcMain.handle('localdb-get-cogs', async () => {
    if (!localDb) return [];
    const stmt = localDb.prepare('SELECT * FROM cogs ORDER BY menu_code ASC');
    return stmt.all();
  });

  // Contacts
  ipcMain.handle('localdb-upsert-contacts', async (event, rows: RowArray) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: RowArray) => {
      const stmt = localDb!.prepare(`INSERT INTO contacts (
        id, no_ktp, nama, phone_number, tgl_lahir, no_kk, created_at, updated_at,
        is_active, jenis_kelamin, kota, kecamatan, source_id, pekerjaan_id,
        source_lainnya, alamat, team_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        no_ktp=excluded.no_ktp, nama=excluded.nama, phone_number=excluded.phone_number,
        tgl_lahir=excluded.tgl_lahir, no_kk=excluded.no_kk, created_at=excluded.created_at,
        updated_at=excluded.updated_at, is_active=excluded.is_active, jenis_kelamin=excluded.jenis_kelamin,
        kota=excluded.kota, kecamatan=excluded.kecamatan, source_id=excluded.source_id,
        pekerjaan_id=excluded.pekerjaan_id, source_lainnya=excluded.source_lainnya,
        alamat=excluded.alamat, team_id=excluded.team_id`);
      for (const r of data) {
        stmt.run(r.id, r.no_ktp, r.nama, r.phone_number, r.tgl_lahir, r.no_kk, r.created_at, Date.now(),
                r.is_active, r.jenis_kelamin, r.kota, r.kecamatan, r.source_id, r.pekerjaan_id,
                r.source_lainnya, r.alamat, r.team_id);
      }
    });
    tx(rows);
    return { success: true };
  });

  ipcMain.handle('localdb-get-contacts', async (event, teamId?: number) => {
    if (!localDb) return [];
    if (teamId) {
      const stmt = localDb.prepare('SELECT * FROM contacts WHERE team_id = ? AND is_active = 1 ORDER BY nama ASC');
      return stmt.all(teamId);
    } else {
      const stmt = localDb.prepare('SELECT * FROM contacts WHERE is_active = 1 ORDER BY nama ASC');
      return stmt.all();
    }
  });

  // Teams
  ipcMain.handle('localdb-upsert-teams', async (event, rows: RowArray) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: RowArray) => {
      const stmt = localDb!.prepare(`INSERT INTO teams (
        id, name, description, organization_id, team_lead_id, business_id, color, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, description=excluded.description, organization_id=excluded.organization_id,
        team_lead_id=excluded.team_lead_id, business_id=excluded.business_id, color=excluded.color,
        is_active=excluded.is_active, created_at=excluded.created_at, updated_at=excluded.updated_at`);
      for (const r of data) {
        stmt.run(r.id, r.name, r.description, r.organization_id, r.team_lead_id, r.business_id,
                r.color, r.is_active, r.created_at, Date.now());
      }
    });
    tx(rows);
    return { success: true };
  });

  ipcMain.handle('localdb-get-teams', async () => {
    if (!localDb) return [];
    const stmt = localDb.prepare('SELECT * FROM teams WHERE is_active = 1 ORDER BY name ASC');
    return stmt.all();
  });

  // Roles
  ipcMain.handle('localdb-upsert-roles', async (event, rows: RowArray) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: RowArray) => {
      const stmt = localDb!.prepare(`INSERT INTO roles (
        id, name, description, organization_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        description=excluded.description,
        organization_id=excluded.organization_id,
        created_at=excluded.created_at,
        updated_at=excluded.updated_at`);
      for (const r of data) {
        stmt.run(r.id, r.name, r.description, r.organization_id, r.created_at, Date.now());
      }
    });
    tx(rows ?? []);
    return { success: true };
  });

  ipcMain.handle('localdb-get-roles', async () => {
    if (!localDb) return [];
    const stmt = localDb.prepare('SELECT * FROM roles ORDER BY name ASC');
    return stmt.all();
  });

  // Permissions
  ipcMain.handle('localdb-upsert-permissions', async (event, rows: RowArray) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: RowArray) => {
      const stmt = localDb!.prepare(`INSERT INTO permissions (
        id, name, description, created_at, category_id, organization_id, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        description=excluded.description,
        created_at=excluded.created_at,
        category_id=excluded.category_id,
        organization_id=excluded.organization_id,
        status=excluded.status`);
      for (const r of data) {
        stmt.run(
          r.id,
          r.name,
          r.description,
          r.created_at,
          r.category_id,
          r.organization_id,
          r.status ?? 'active'
        );
      }
    });
    tx(rows ?? []);
    return { success: true };
  });

  ipcMain.handle('localdb-get-permissions', async () => {
    if (!localDb) return [];
    const stmt = localDb.prepare('SELECT * FROM permissions ORDER BY name ASC');
    return stmt.all();
  });

  // Role permissions
  ipcMain.handle('localdb-upsert-role-permissions', async (event, rows: RowArray) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: RowArray) => {
      localDb!.prepare('DELETE FROM role_permissions').run();
      const stmt = localDb!.prepare(`INSERT INTO role_permissions (
        role_id, permission_id
      ) VALUES (?, ?)
      ON CONFLICT(role_id, permission_id) DO NOTHING`);
      for (const r of data) {
        stmt.run(r.role_id, r.permission_id);
      }
    });
    tx(rows ?? []);
    return { success: true };
  });

  ipcMain.handle('localdb-get-role-permissions', async (event, roleId: number) => {
    if (!localDb) return [];
    const stmt = localDb.prepare(`
      SELECT p.id, p.name, p.status
      FROM role_permissions rp
      INNER JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = ?
      ORDER BY p.name ASC
    `);
    return stmt.all(roleId);
  });

  // Aggregated auth helper
  type LocalDbUser = {
    id: number;
    email: string;
    password: string | null;
    name: string | null;
    role_id: number | null;
    organization_id: number | null;
  };

  ipcMain.handle('localdb-get-user-auth', async (event, email: string) => {
    if (!localDb) return null;
    const userStmt = localDb.prepare(`
      SELECT id, email, password, name, role_id, organization_id
      FROM users
      WHERE LOWER(email) = LOWER(?)
      LIMIT 1
    `);
    const user = userStmt.get(email) as LocalDbUser | undefined;

    if (!user) {
      return null;
    }

    let roleName: string | null = null;
    if (user.role_id !== null && user.role_id !== undefined) {
      const roleStmt = localDb.prepare('SELECT name FROM roles WHERE id = ? LIMIT 1');
      const role = roleStmt.get(user.role_id) as { name?: string } | undefined;
      roleName = role?.name ?? null;
    }

    const permissionsStmt = localDb.prepare(`
      SELECT p.name
      FROM role_permissions rp
      INNER JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = ?
      ORDER BY p.name ASC
    `);
    const permissionRows = (user.role_id !== null && user.role_id !== undefined)
      ? (permissionsStmt.all(user.role_id) as Array<{ name: string }>)
      : [];

    return {
      ...user,
      role_name: roleName,
      permissions: Array.isArray(permissionRows) ? permissionRows.map((row) => row.name) : [],
    };
  });

  // Supporting tables
  ipcMain.handle('localdb-upsert-source', async (event, rows: RowArray) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: RowArray) => {
      const stmt = localDb!.prepare(`INSERT INTO source (id, source_name, created_at, updated_at) 
        VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
        source_name=excluded.source_name, created_at=excluded.created_at, updated_at=excluded.updated_at`);
      for (const r of data) {
        stmt.run(r.id, r.source_name, r.created_at, Date.now());
      }
    });
    tx(rows);
    return { success: true };
  });

  ipcMain.handle('localdb-get-source', async () => {
    if (!localDb) return [];
    const stmt = localDb.prepare('SELECT * FROM source ORDER BY source_name ASC');
    return stmt.all();
  });

  ipcMain.handle('localdb-upsert-pekerjaan', async (event, rows: RowArray) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: RowArray) => {
      const stmt = localDb!.prepare(`INSERT INTO pekerjaan (id, nama_pekerjaan, created_at, updated_at) 
        VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
        nama_pekerjaan=excluded.nama_pekerjaan, created_at=excluded.created_at, updated_at=excluded.updated_at`);
      for (const r of data) {
        stmt.run(r.id, r.nama_pekerjaan, r.created_at, Date.now());
      }
    });
    tx(rows);
    return { success: true };
  });

  ipcMain.handle('localdb-get-pekerjaan', async () => {
    if (!localDb) return [];
    const stmt = localDb.prepare('SELECT * FROM pekerjaan ORDER BY nama_pekerjaan ASC');
    return stmt.all();
  });

  // New table handlers for enhanced offline support
  
  // Transactions
  ipcMain.handle('localdb-upsert-transactions', async (event, rows: RowArray) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: RowArray) => {
      const stmt = localDb!.prepare(`INSERT INTO transactions (
        id, business_id, user_id, shift_uuid, payment_method, pickup_method, total_amount,
        voucher_discount, voucher_type, voucher_value, voucher_label, final_amount, amount_received, change_amount, status,
        created_at, updated_at, synced_at, contact_id, customer_name, customer_unit, note, bank_name,
        card_number, cl_account_id, cl_account_name, bank_id, receipt_number,
        transaction_type, payment_method_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        business_id=excluded.business_id, user_id=excluded.user_id, shift_uuid=excluded.shift_uuid, payment_method=excluded.payment_method,
        pickup_method=excluded.pickup_method, total_amount=excluded.total_amount, voucher_discount=excluded.voucher_discount,
        voucher_type=excluded.voucher_type, voucher_value=excluded.voucher_value, voucher_label=excluded.voucher_label,
        final_amount=excluded.final_amount, amount_received=excluded.amount_received, change_amount=excluded.change_amount,
        status=excluded.status, created_at=excluded.created_at, updated_at=excluded.updated_at, synced_at=excluded.synced_at,
        contact_id=excluded.contact_id, customer_name=excluded.customer_name, customer_unit=excluded.customer_unit, note=excluded.note,
        bank_name=excluded.bank_name, card_number=excluded.card_number, cl_account_id=excluded.cl_account_id,
        cl_account_name=excluded.cl_account_name, bank_id=excluded.bank_id, receipt_number=excluded.receipt_number,
        transaction_type=excluded.transaction_type, payment_method_id=excluded.payment_method_id`);
      for (const r of data) {
        // Auto-link to active shift if shift_uuid is missing
        let finalShiftUuid = r.shift_uuid;
        if (!finalShiftUuid && r.user_id) {
          try {
            const shiftStmt = localDb!.prepare(`
              SELECT uuid_id 
              FROM shifts 
              WHERE user_id = ? AND status = 'active' AND business_id = ?
              ORDER BY shift_start DESC 
              LIMIT 1
            `);
            const activeShift = shiftStmt.get(r.user_id, r.business_id ?? 14) as { uuid_id: string } | undefined;
            if (activeShift) {
              finalShiftUuid = activeShift.uuid_id;
              console.log(`🔗 [UPSERT] Linked transaction ${r.id} to active shift ${finalShiftUuid}`);
            }
          } catch (e) {
            console.warn('Failed to link transaction to active shift during upsert:', e);
          }
        }

        console.log('🔍 [SQLITE] Inserting transaction data:', {
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
          payment_method_id: r.payment_method_id
        });
        
        const params = [
          r.id,
          r.business_id,
          r.user_id,
          finalShiftUuid || null,
          r.payment_method,
          r.pickup_method,
          Number(r.total_amount),
          Number(r.voucher_discount ?? 0.0),
          r.voucher_type ?? 'none',
          r.voucher_value !== undefined && r.voucher_value !== null ? Number(r.voucher_value) : null,
          r.voucher_label ?? null,
          Number(r.final_amount),
          Number(r.amount_received),
          Number(r.change_amount ?? 0.0),
          r.status ?? 'completed',
          r.created_at,
          Date.now(),
          r.synced_at ?? null, // Keep existing synced_at or NULL for new unsynced transactions
          r.contact_id ?? null,
          r.customer_name ?? null,
        typeof r.customer_unit === 'number' ? r.customer_unit : (r.customer_unit ? Number(r.customer_unit) : null),
          r.note ?? null,
          r.bank_name ?? null,
          r.card_number ?? null,
          r.cl_account_id ?? null,
          r.cl_account_name ?? null,
          r.bank_id ? Number(r.bank_id) : null,
          r.receipt_number ?? null,
          r.transaction_type ?? 'drinks',
          Number(r.payment_method_id)
        ];
        
        console.log('📝 [SQLITE] Calling stmt.run with params:', params);
        console.log('📊 [SQLITE] Params count:', params.length);
        
        // Debug: Get column names from the prepared statement
        try {
          const info = stmt.run(...params);
          console.log('✅ [SQLITE] Insert successful:', info);
        } catch (err: unknown) {
          console.error('❌ [SQLITE] Insert error:', err);
          if (err && typeof err === 'object' && 'code' in err) {
            console.error('📝 [SQLITE] Error code:', (err as { code: unknown }).code);
          }
          if (err && typeof err === 'object' && 'message' in err) {
            console.error('📝 [SQLITE] Error message:', (err as { message: unknown }).message);
          }
          throw err;
        }
      }
    });
    tx(rows);
    return { success: true };
  });

  ipcMain.handle('localdb-get-transactions', async (event, businessId?: number, limit?: number) => {
    if (!localDb) return [];
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
    `;
    const params: QueryParams = [];
    const conditions: string[] = [];
    
    // Exclude archived transactions
    conditions.push('t.status != \'archived\'');
    
    if (businessId) {
      conditions.push('t.business_id = ?');
      params.push(businessId);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY t.created_at DESC';
    
    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
    }
    
    const stmt = localDb.prepare(query);
    return stmt.all(...params);
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
      params.push(startIso);
    }
    if (endIso) {
      conditions.push(`${prefix}created_at <= ?`);
      params.push(endIso);
    }

    return { clause: conditions.join(' AND '), params };
  };

  // Archive transactions
  ipcMain.handle('localdb-archive-transactions', async (event, payload: { businessId: number; from?: string | null; to?: string | null }) => {
    if (!localDb) return 0;

    const businessId = payload?.businessId;
    if (!businessId) return 0;

    const startIso = ensureIsoString(payload.from);
    const endIso = ensureIsoString(payload.to);

    try {
      const { clause: baseClause, params } = buildTransactionFilter(businessId, startIso, endIso);
      const timestamp = Date.now();
      const updateStmt = localDb.prepare(`
        UPDATE transactions 
        SET status = 'archived', updated_at = ?
        WHERE ${baseClause} AND status != 'archived'
      `);
      
      const result = updateStmt.run(timestamp, ...params);
      console.log(`✅ [ARCHIVE] Archived ${result.changes} transactions`);
      // Also clear related printer audits for archived transactions
      try {
        const archivedClause = `${baseClause} AND status = 'archived'`;
        const delP1 = localDb.prepare(`
          DELETE FROM printer1_audit_log
          WHERE transaction_id IN (
            SELECT id FROM transactions WHERE ${archivedClause}
          )
        `);
        delP1.run(...params);
        const delP2 = localDb.prepare(`
          DELETE FROM printer2_audit_log
          WHERE transaction_id IN (
            SELECT id FROM transactions WHERE ${archivedClause}
          )
        `);
        delP2.run(...params);
      } catch (e) {
        console.warn('⚠️ [ARCHIVE] Failed to clear printer audits for archived transactions:', e);
      }
      return result.changes;
    } catch (error) {
      console.error('❌ [ARCHIVE] Failed to archive transactions:', error);
      throw error;
    }
  });

  // Delete transactions permanently
  ipcMain.handle('localdb-delete-transactions', async (event, payload: { businessId: number; from?: string | null; to?: string | null }) => {
    if (!localDb) return 0;

    const businessId = payload?.businessId;
    if (!businessId) return 0;

    const startIso = ensureIsoString(payload.from);
    const endIso = ensureIsoString(payload.to);
    
    try {
      const { clause: baseClause, params } = buildTransactionFilter(businessId, startIso, endIso);
      // Delete printer audits first
      const delP1 = localDb.prepare(`
        DELETE FROM printer1_audit_log 
        WHERE transaction_id IN (
          SELECT id FROM transactions WHERE ${baseClause}
        )
      `);
      delP1.run(...params);
      const delP2 = localDb.prepare(`
        DELETE FROM printer2_audit_log 
        WHERE transaction_id IN (
          SELECT id FROM transactions WHERE ${baseClause}
        )
      `);
      delP2.run(...params);

      const stmt = localDb.prepare(`
        DELETE FROM transactions 
        WHERE ${baseClause}
      `);
      
      const result = stmt.run(...params);
      console.log(`🗑️ [DELETE] Deleted ${result.changes} transactions`);
      return result.changes;
    } catch (error) {
      console.error('❌ [DELETE] Failed to delete transactions:', error);
      throw error;
    }
  });

  // Delete transactions by user email (both offline and online)
  ipcMain.handle('localdb-delete-transactions-by-email', async (event, payload: { userEmail: string }) => {
    if (!localDb) return { success: false, deleted: 0, error: 'Database not available' };

    const userEmail = payload?.userEmail;
    if (!userEmail) return { success: false, deleted: 0, error: 'User email is required' };

    try {
      // First, get user ID from email
      const userStmt = localDb.prepare('SELECT id FROM users WHERE email = ? LIMIT 1');
      const user = userStmt.get(userEmail) as { id: number } | undefined;
      
      if (!user) {
        return { success: false, deleted: 0, error: `User with email ${userEmail} not found` };
      }

      const userId = user.id;
      console.log(`🗑️ [DELETE BY EMAIL] Found user ID ${userId} for email ${userEmail}`);

      // Delete printer audit logs first
      const delP1 = localDb.prepare(`
        DELETE FROM printer1_audit_log 
        WHERE transaction_id IN (
          SELECT id FROM transactions WHERE user_id = ?
        )
      `);
      const p1Result = delP1.run(userId);
      console.log(`🗑️ [DELETE BY EMAIL] Deleted ${p1Result.changes} printer1 audit log entries`);

      const delP2 = localDb.prepare(`
        DELETE FROM printer2_audit_log 
        WHERE transaction_id IN (
          SELECT id FROM transactions WHERE user_id = ?
        )
      `);
      const p2Result = delP2.run(userId);
      console.log(`🗑️ [DELETE BY EMAIL] Deleted ${p2Result.changes} printer2 audit log entries`);

      // Delete transaction items first (foreign key constraint)
      const delItemsStmt = localDb.prepare(`
        DELETE FROM transaction_items 
        WHERE transaction_id IN (
          SELECT id FROM transactions WHERE user_id = ?
        )
      `);
      const itemsResult = delItemsStmt.run(userId);
      console.log(`🗑️ [DELETE BY EMAIL] Deleted ${itemsResult.changes} transaction items`);

      // Delete transactions
      const delTxStmt = localDb.prepare('DELETE FROM transactions WHERE user_id = ?');
      const txResult = delTxStmt.run(userId);
      console.log(`🗑️ [DELETE BY EMAIL] Deleted ${txResult.changes} transactions for user ${userEmail} (ID: ${userId})`);

      return { success: true, deleted: txResult.changes, deletedItems: itemsResult.changes };
    } catch (error) {
      console.error('❌ [DELETE BY EMAIL] Failed to delete transactions:', error);
      return { success: false, deleted: 0, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Delete transaction items permanently
  ipcMain.handle('localdb-delete-transaction-items', async (event, payload: { businessId: number; from?: string | null; to?: string | null }) => {
    if (!localDb) return { success: true };

    const businessId = payload?.businessId;
    if (!businessId) return { success: true };

    const startIso = ensureIsoString(payload.from);
    const endIso = ensureIsoString(payload.to);
    
    try {
      const { clause: baseClause, params } = buildTransactionFilter(businessId, startIso, endIso);
      const stmt = localDb.prepare(`
        DELETE FROM transaction_items 
        WHERE transaction_id IN (
          SELECT id FROM transactions WHERE ${baseClause}
        )
      `);
      
      const result = stmt.run(...params);
      console.log(`🗑️ [DELETE] Deleted ${result.changes} transaction items`);
      return { success: true, deleted: result.changes };
    } catch (error) {
      console.error('❌ [DELETE] Failed to delete transaction items:', error);
      throw error;
    }
  });
  
  // Get transactions that are not yet synced to cloud
  ipcMain.handle('localdb-get-unsynced-transactions', async (event, businessId?: number) => {
    if (!localDb) return [];
    
    // For now, return all transactions where receipt_number is null or synced_at is null
    // This indicates they haven't been synced to cloud yet
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
      WHERE t.synced_at IS NULL
    `;
    const params: QueryParams = [];
    
    if (businessId) {
      query += ' AND t.business_id = ?';
      params.push(businessId);
    }
    
    query += ' ORDER BY t.created_at DESC';
    
    const stmt = localDb.prepare(query);
    const transactions = stmt.all(...params);
    
    // ✅ NEW: Fetch transaction items for each transaction
    if (Array.isArray(transactions) && transactions.length > 0) {
      const itemsStmt = localDb.prepare('SELECT * FROM transaction_items WHERE transaction_id = ?');
      
      for (const transaction of transactions as any[]) {
        const items = itemsStmt.all(transaction.id);
        transaction.items = items || [];
      }
    }
    
    return transactions;
  });

  // Transaction Items
  ipcMain.handle('localdb-upsert-transaction-items', async (event, rows: RowArray) => {
    if (!localDb) return { success: false };
    console.log('🔍 [SQLITE] Inserting transaction items:', rows.length);
    const tx = localDb.transaction((data: RowArray) => {
      const stmt = localDb!.prepare(`INSERT INTO transaction_items (
        id, transaction_id, product_id, quantity, unit_price, total_price,
        bundle_selections_json, custom_note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        transaction_id=excluded.transaction_id, product_id=excluded.product_id, quantity=excluded.quantity,
        unit_price=excluded.unit_price, total_price=excluded.total_price,
        bundle_selections_json=excluded.bundle_selections_json,
        custom_note=excluded.custom_note, created_at=excluded.created_at`);
      for (const r of data) {
        console.log('📦 [SQLITE] Item data:', {
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
        
        console.log('📝 [SQLITE] Custom note:', r.custom_note);
        
        stmt.run(r.id, r.transaction_id, r.product_id, r.quantity || 1, r.unit_price, r.total_price,
                bundleSelectionsJson, r.custom_note, r.created_at);
        
        // Save main product customizations directly to normalized tables (NO JSON)
        if (r.customizations && Array.isArray(r.customizations)) {
          try {
            const customizations = r.customizations as RawCustomization[];
            if (customizations.length > 0) {
              saveCustomizationsToNormalizedTables(
                localDb!,
                r.id as string,
                customizations,
                r.created_at as string || new Date().toISOString()
              );
            }
          } catch (error) {
            console.error('❌ Error saving main product customizations to normalized tables:', error);
          }
        }
        
        // Extract and save bundle product customizations to normalized tables (NO JSON)
        if (bundleSelectionsData && bundleSelectionsData.length > 0) {
          try {
            const transactionItemId = r.id as string;
            const createdAt = r.created_at as string || new Date().toISOString();
            
            for (const bundleSelection of bundleSelectionsData) {
              if (!Array.isArray(bundleSelection.selectedProducts)) continue;
              
              for (const selectedProduct of bundleSelection.selectedProducts) {
                // Each bundle product can have customizations
                if (selectedProduct.customizations && Array.isArray(selectedProduct.customizations) && selectedProduct.customizations.length > 0) {
                  const bundleProductCustomizations = selectedProduct.customizations as RawCustomization[];
                  
                  // Save bundle product customizations to normalized tables
                  // Link them to the bundle product ID so we can reconstruct them later
                  const bundleProductId = selectedProduct.product?.id || null;
                  saveCustomizationsToNormalizedTables(
                    localDb!,
                    transactionItemId,
                    bundleProductCustomizations,
                    createdAt,
                    bundleProductId
                  );
                }
              }
            }
          } catch (error) {
            console.error('❌ Error saving bundle product customizations to normalized tables:', error);
          }
        }
      }
    });
    tx(rows);
    console.log('✅ [SQLITE] Transaction items inserted');
    return { success: true };
  });

  ipcMain.handle('localdb-get-transaction-items', async (event, transactionId?: number | string) => {
    if (!localDb) return [];
    
    // Get transaction items
    let items: Array<Record<string, unknown>> = [];
    if (transactionId) {
      const stmt = localDb.prepare('SELECT * FROM transaction_items WHERE transaction_id = ? ORDER BY id ASC');
      items = stmt.all(transactionId) as Array<Record<string, unknown>>;
    } else {
      const stmt = localDb.prepare('SELECT * FROM transaction_items ORDER BY created_at DESC');
      items = stmt.all() as Array<Record<string, unknown>>;
    }
    
    // For each item, load customizations from normalized tables
    const itemsWithCustomizations = items.map(item => {
      const itemId = item.id as string;
      
      // Read main product customizations from normalized tables (bundle_product_id IS NULL)
      const customizations = readCustomizationsFromNormalizedTables(localDb!, itemId, null);
      
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
            bundleSelections = bundleSelections.map(bundleSel => {
              if (!Array.isArray(bundleSel.selectedProducts)) return bundleSel;
              
              return {
                ...bundleSel,
                selectedProducts: bundleSel.selectedProducts.map(selectedProduct => {
                  const bundleProductId = selectedProduct.product?.id;
                  if (!bundleProductId) return selectedProduct;
                  
                  // Read customizations for this specific bundle product from normalized tables
                  const productCustomizations = readCustomizationsFromNormalizedTables(
                    localDb!,
                    itemId,
                    bundleProductId
                  );
                  
                  return {
                    ...selectedProduct,
                    customizations: productCustomizations || undefined
                  };
                })
              };
            });
          }
        } catch (error) {
          console.warn('⚠️ Error reconstructing bundle selections:', error);
        }
      }
      
      return {
        ...item,
        customizations: customizations || [],  // Main product customizations
        bundleSelections: bundleSelections || null  // Bundle selections with customizations from normalized tables
      };
    });
    
    return itemsWithCustomizations;
  });

  ipcMain.handle('localdb-get-transaction-refunds', async (event, transactionUuid: string) => {
    if (!localDb) return [];
    try {
      const stmt = localDb.prepare(`
        SELECT *
        FROM transaction_refunds
        WHERE transaction_uuid = ?
        ORDER BY datetime(refunded_at) DESC, id DESC
      `);
      return stmt.all(transactionUuid);
    } catch (error) {
      console.error('Error getting transaction refunds:', error);
      return [];
    }
  });

  ipcMain.handle('localdb-upsert-transaction-refunds', async (event, rows: RowArray) => {
    if (!localDb) return { success: false, error: 'Database not available' };
    try {
      const tx = localDb.transaction((data: RowArray) => {
        const stmt = localDb!.prepare(`
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
          ON CONFLICT(uuid_id) DO UPDATE SET
            transaction_uuid = excluded.transaction_uuid,
            business_id = excluded.business_id,
            shift_uuid = excluded.shift_uuid,
            refunded_by = excluded.refunded_by,
            refund_amount = excluded.refund_amount,
            cash_delta = excluded.cash_delta,
            payment_method_id = excluded.payment_method_id,
            reason = excluded.reason,
            note = excluded.note,
            refund_type = excluded.refund_type,
            status = excluded.status,
            refunded_at = excluded.refunded_at,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            synced_at = excluded.synced_at
        `);

        for (const r of data) {
          stmt.run(
            r.uuid_id,
            r.transaction_uuid,
            Number(r.business_id ?? 14),
            r.shift_uuid ?? null,
            Number(r.refunded_by ?? 0),
            Number(r.refund_amount ?? 0),
            Number(r.cash_delta ?? 0),
            Number(r.payment_method_id ?? 1),
            r.reason ?? null,
            r.note ?? null,
            r.refund_type ?? 'full',
            r.status ?? 'completed',
            r.refunded_at ?? new Date().toISOString(),
            r.created_at ?? new Date().toISOString(),
            typeof r.updated_at === 'number' ? r.updated_at : Date.now(),
            typeof r.synced_at === 'number' ? r.synced_at : Date.now()
          );
        }
      });
      tx(rows);
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
    if (!localDb) return { success: false, error: 'Database not available' };
    try {
      const { refund, transactionUpdate } = payload || {};
      if (!refund || !refund.uuid_id) {
        return { success: false, error: 'Invalid refund payload' };
      }

      const refundedAt = refund.refunded_at ?? new Date().toISOString();
      const createdAt = refund.created_at ?? refundedAt;
      const updatedAt = refund.updated_at ?? Date.now();
      const syncedAt = refund.synced_at ?? null;

      const stmt = localDb.prepare(`
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
        ON CONFLICT(uuid_id) DO UPDATE SET
          transaction_uuid = excluded.transaction_uuid,
          business_id = excluded.business_id,
          shift_uuid = excluded.shift_uuid,
          refunded_by = excluded.refunded_by,
          refund_amount = excluded.refund_amount,
          cash_delta = excluded.cash_delta,
          payment_method_id = excluded.payment_method_id,
          reason = excluded.reason,
          note = excluded.note,
          refund_type = excluded.refund_type,
          status = excluded.status,
          refunded_at = excluded.refunded_at,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          synced_at = excluded.synced_at
      `);

      stmt.run(
        refund.uuid_id,
        refund.transaction_uuid,
        Number(refund.business_id ?? 14),
        refund.shift_uuid ?? null,
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
      );

      if (transactionUpdate?.id) {
        const txUpdateStmt = localDb.prepare(`
          UPDATE transactions
          SET refund_status = COALESCE(?, refund_status),
              refund_total = COALESCE(?, refund_total),
              last_refunded_at = COALESCE(?, last_refunded_at),
              status = COALESCE(?, status)
          WHERE id = ?
        `);
        txUpdateStmt.run(
          transactionUpdate.refund_status ?? null,
          typeof transactionUpdate.refund_total === 'number' ? transactionUpdate.refund_total : null,
          transactionUpdate.last_refunded_at ?? refundedAt,
          transactionUpdate.status ?? null,
          transactionUpdate.id
        );
      }

      return { success: true };
    } catch (error) {
      console.error('Error applying transaction refund:', error);
      return { success: false, error: String(error) };
    }
  });

  // Mark transactions as synced
  ipcMain.handle('localdb-mark-transactions-synced', async (event, transactionIds: string[]) => {
    if (!localDb || transactionIds.length === 0) return { success: true };
    
    try {
      const stmt = localDb.prepare('UPDATE transactions SET synced_at = ? WHERE id IN (' + transactionIds.map(() => '?').join(',') + ')');
      stmt.run(Date.now(), ...transactionIds);
      return { success: true };
    } catch (error) {
      console.error('Error marking transactions as synced:', error);
      return { success: false };
    }
  });

  // Reset transaction sync status (set synced_at to NULL)
  ipcMain.handle('localdb-reset-transaction-sync', async (event, transactionId: string) => {
    if (!localDb) return { success: false };
    
    try {
      const stmt = localDb.prepare('UPDATE transactions SET synced_at = NULL WHERE id = ?');
      stmt.run(transactionId);
      console.log(`🔄 [RESET SYNC] Transaction ${transactionId} synced_at reset to NULL`);
      return { success: true };
    } catch (error) {
      console.error('Error resetting transaction sync status:', error);
      return { success: false };
    }
  });

  // ========== SHIFTS IPC HANDLERS ==========
  
  // Get active shift for a business (with ownership flag)
  ipcMain.handle('localdb-get-active-shift', async (event, userId: number, businessId: number = 14) => {
    if (!localDb) {
      return { shift: null, isCurrentUserShift: false };
    }
    try {
      const stmt = localDb.prepare(`
        SELECT *
        FROM shifts 
        WHERE business_id = ? AND status = 'active'
        ORDER BY shift_start ASC
        LIMIT 1
      `);
      const shift = stmt.get(businessId) as ShiftRow | undefined;
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

  // Get shifts history
  ipcMain.handle('localdb-get-shifts', async (event, params: {
    userId?: number;
    startDate?: string;
    endDate?: string;
    businessId?: number;
    limit?: number;
    offset?: number;
  }) => {
    if (!localDb) return { shifts: [], total: 0 };
    
    try {
      const { userId, startDate, endDate, businessId = 14, limit = 20, offset = 0 } = params;
      const conditions: string[] = ['business_id = ?'];
      const queryParams: (string | number)[] = [businessId];

      if (userId) {
        conditions.push('user_id = ?');
        queryParams.push(userId);
      }

      if (startDate) {
        conditions.push('datetime(shift_start) >= datetime(?)');
        queryParams.push(startDate);
      }

      if (endDate) {
        conditions.push('datetime(shift_start) <= datetime(?)');
        queryParams.push(endDate);
      }

      const whereClause = conditions.join(' AND ');
      
      const countStmt = localDb.prepare(`SELECT COUNT(*) as count FROM shifts WHERE ${whereClause}`);
      const total = (countStmt.get(...queryParams) as { count: number }).count;

      const query = `
        SELECT * FROM shifts 
        WHERE ${whereClause}
        ORDER BY shift_start DESC
        LIMIT ? OFFSET ?
      `;
      
      const stmt = localDb.prepare(query);
      const shifts = stmt.all(...queryParams, limit, offset);

      return { shifts, total };
    } catch (error) {
      console.error('Error getting shifts history:', error);
      return { shifts: [], total: 0 };
    }
  });

  // Get all users who have shifts
  ipcMain.handle('localdb-get-shift-users', async (event, businessId: number = 14) => {
    if (!localDb) return [];
    try {
        const stmt = localDb.prepare(`
            SELECT DISTINCT user_id, user_name 
            FROM shifts 
            WHERE business_id = ? 
            ORDER BY user_name
        `);
        return stmt.all(businessId);
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
    if (!localDb) return { success: false, error: 'Database not available' };
    try {
      // Validate that business exists (required for foreign key constraint)
      const businessStmt = localDb.prepare('SELECT id FROM businesses WHERE id = ? LIMIT 1');
      const business = businessStmt.get(shiftData.business_id) as { id: number } | undefined;
      if (!business) {
        console.error(`❌ [SHIFTS] Business ID ${shiftData.business_id} not found in local database`);
        return { 
          success: false, 
          error: `Business ID ${shiftData.business_id} tidak ditemukan di database lokal. Silakan sinkronkan data dari server terlebih dahulu.` 
        };
      }

      // Validate that user exists (required for foreign key constraint)
      const userStmt = localDb.prepare('SELECT id FROM users WHERE id = ? LIMIT 1');
      const user = userStmt.get(shiftData.user_id) as { id: number } | undefined;
      if (!user) {
        console.error(`❌ [SHIFTS] User ID ${shiftData.user_id} not found in local database`);
        return { 
          success: false, 
          error: `User ID ${shiftData.user_id} tidak ditemukan di database lokal. Silakan sinkronkan data dari server terlebih dahulu.` 
        };
      }

      // Ensure there is no other active shift for the business
      const existingStmt = localDb.prepare(`
        SELECT id, user_id, user_name, shift_start
        FROM shifts
        WHERE business_id = ? AND status = 'active'
        ORDER BY shift_start ASC
        LIMIT 1
      `);
      const existingShift = existingStmt.get(shiftData.business_id) as ShiftRow | undefined;

      if (existingShift) {
        return { success: false, error: 'ACTIVE_SHIFT_EXISTS', activeShift: existingShift };
      }

      const now = new Date().toISOString();
      const stmt = localDb.prepare(`
        INSERT INTO shifts (
          uuid_id, business_id, user_id, user_name, shift_start, 
          modal_awal, status, created_at, updated_at, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL)
      `);
      
      stmt.run(
        shiftData.uuid_id,
        shiftData.business_id,
        shiftData.user_id,
        shiftData.user_name,
        now,
        shiftData.modal_awal,
        now,
        Date.now()
      );
      
      console.log(`✅ [SHIFTS] Created shift ${shiftData.uuid_id} for user ${shiftData.user_id}`);
      return { success: true };
    } catch (error) {
      console.error('Error creating shift:', error);
      const errorMessage = String(error);
      // Provide more helpful error message for foreign key constraint failures
      if (errorMessage.includes('FOREIGN KEY constraint failed')) {
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
    if (!localDb) return { success: false, error: 'Database not available' };
    try {
      const { shiftId, kasAkhir } = payload || {};
      if (!shiftId) {
        return { success: false, error: 'Shift ID is required' };
      }

      const shiftRow = localDb.prepare(`SELECT * FROM shifts WHERE id = ?`).get(shiftId) as {
        id: number;
        business_id: number;
        user_id: number;
        shift_start: string;
        modal_awal: number;
        status: string;
        uuid_id?: string;
      } | undefined;

      if (!shiftRow) {
        return { success: false, error: 'Shift not found' };
      }

      if (shiftRow.status !== 'active') {
        return { success: false, error: 'Shift already ended' };
      }

      const now = new Date().toISOString();
      const cashMethodStmt = localDb.prepare('SELECT id FROM payment_methods WHERE code = ? LIMIT 1');
      const cashMethod = cashMethodStmt.get('cash') as { id: number } | undefined;
      const cashMethodId = cashMethod?.id || 1;

      const shiftSalesStmt = localDb.prepare(`
        SELECT COALESCE(SUM(final_amount), 0) as cash_total
        FROM transactions
        WHERE business_id = ?
          AND user_id = ?
          AND datetime(created_at) >= datetime(?)
          AND datetime(created_at) <= datetime(?)
          AND payment_method_id = ?
          AND status = 'completed'
      `);
      const shiftSalesResult = shiftSalesStmt.get(
        shiftRow.business_id,
        shiftRow.user_id,
        shiftRow.shift_start,
        now,
        cashMethodId
      ) as { cash_total: number };

      const shiftRefundStmt = localDb.prepare(`
        SELECT COALESCE(SUM(cash_delta), 0) as refund_total
        FROM transaction_refunds
        WHERE business_id = ?
          AND refunded_by = ?
          AND datetime(refunded_at) >= datetime(?)
          AND datetime(refunded_at) <= datetime(?)
          AND status != 'failed'
      `);
      const shiftRefundResult = shiftRefundStmt.get(
        shiftRow.business_id,
        shiftRow.user_id,
        shiftRow.shift_start,
        now
      ) as { refund_total: number };

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

      const stmt = localDb.prepare(`
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
      `);

      const result = stmt.run(
        now,
        Date.now(),
        kasAkhirValue,
        kasExpected,
        kasSelisih,
        kasSelisihLabel,
        cashSalesTotal,
        cashRefundTotal,
        shiftId
      );
      
      if (result.changes === 0) {
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
  ipcMain.handle('localdb-get-shift-statistics', async (event, userId: number, shiftStart: string, shiftEnd: string | null, businessId: number = 14) => {
    if (!localDb) return {
      order_count: 0,
      total_amount: 0,
      total_discount: 0,
      voucher_count: 0
    };
    
    try {
      // Combined statistics query including voucher metrics
      let statsQuery = `
        SELECT 
          COUNT(*) as order_count,
          COALESCE(SUM(final_amount), 0) as total_amount,
          COALESCE(SUM(voucher_discount), 0) as total_discount,
          COALESCE(SUM(CASE WHEN voucher_discount IS NOT NULL AND voucher_discount > 0 THEN 1 ELSE 0 END), 0) as voucher_count
        FROM transactions
        WHERE user_id = ? AND business_id = ?
        AND datetime(created_at) >= datetime(?)
        AND status = 'completed'
      `;
      const statsParams: QueryParams = [userId, businessId, shiftStart];
      
      if (shiftEnd) {
        statsQuery += ' AND datetime(created_at) <= datetime(?)';
        statsParams.push(shiftEnd);
      }
      
      const statsStmt = localDb.prepare(statsQuery);
      const statsResult = statsStmt.get(...statsParams) as {
        order_count: number;
        total_amount: number;
        total_discount: number;
        voucher_count: number;
      } | undefined;
      
      return {
        order_count: statsResult?.order_count || 0,
        total_amount: statsResult?.total_amount || 0,
        total_discount: statsResult?.total_discount || 0,
        voucher_count: statsResult?.voucher_count || 0
      };
    } catch (error) {
      console.error('Error getting shift statistics:', error);
      return {
        order_count: 0,
        total_amount: 0,
        total_discount: 0,
        voucher_count: 0
      };
    }
  });

  // Get payment method breakdown
  ipcMain.handle('localdb-get-payment-breakdown', async (event, userId: number, shiftStart: string, shiftEnd: string | null, businessId: number = 14) => {
    if (!localDb) return [];
    
    try {
      let query = `
        SELECT 
          pm.name as payment_method_name,
          pm.code as payment_method_code,
          COUNT(t.id) as transaction_count,
          SUM(t.final_amount) as total_amount
        FROM transactions t
        LEFT JOIN payment_methods pm ON t.payment_method_id = pm.id
        WHERE t.user_id = ? AND t.business_id = ?
        AND datetime(t.created_at) >= datetime(?)
        AND t.status = 'completed'
      `;
      const params: QueryParams = [userId, businessId, shiftStart];
      
      if (shiftEnd) {
        query += ' AND datetime(t.created_at) <= datetime(?)';
        params.push(shiftEnd);
      }
      
      query += ' GROUP BY pm.id, pm.name, pm.code ORDER BY transaction_count DESC';
      
      const stmt = localDb.prepare(query);
      return stmt.all(...params);
    } catch (error) {
      console.error('Error getting payment breakdown:', error);
      return [];
    }
  });

  // Get Category II breakdown
  ipcMain.handle('localdb-get-category2-breakdown', async (event, userId: number, shiftStart: string, shiftEnd: string | null, businessId: number = 14) => {
    if (!localDb) return [];
    
    try {
      let query = `
        SELECT 
          COALESCE(c2_by_id.name, c2_by_name.name, p.category2_name, 'Unknown') as category2_name,
          COALESCE(c2_by_id.id, c2_by_name.id, 0) as category2_id,
          COALESCE(SUM(ti.quantity), 0) as total_quantity,
          COALESCE(SUM(ti.total_price), 0) as total_amount
        FROM transaction_items ti
        INNER JOIN transactions t ON ti.transaction_id = t.id
        INNER JOIN products p ON ti.product_id = p.id
        LEFT JOIN category2 c2_by_id ON p.category2_id = c2_by_id.id
        LEFT JOIN category2 c2_by_name ON p.category2_name = c2_by_name.name AND (p.category2_id IS NULL OR p.category2_id = 0)
        WHERE t.user_id = ? AND t.business_id = ?
        AND datetime(t.created_at) >= datetime(?)
        AND t.status = 'completed'
        AND (p.category2_id IS NOT NULL OR (p.category2_name IS NOT NULL AND p.category2_name != ''))
      `;
      const params: QueryParams = [userId, businessId, shiftStart];
      
      if (shiftEnd) {
        query += ' AND datetime(t.created_at) <= datetime(?)';
        params.push(shiftEnd);
      }
      
      query += ' GROUP BY category2_name ORDER BY total_amount DESC';
      
      const stmt = localDb.prepare(query);
      const results = stmt.all(...params);
      console.log(`[CATEGORY2 BREAKDOWN] Found ${results.length} Category II entries for user ${userId}, shift ${shiftStart} to ${shiftEnd || 'now'}`);
      if (results.length > 0) {
        console.log('[CATEGORY2 BREAKDOWN] Sample result:', results[0]);
      }
      return results;
    } catch (error) {
      console.error('Error getting Category II breakdown:', error);
      return [];
    }
  });

  // Get cash summary (shift + whole day)
  ipcMain.handle('localdb-get-cash-summary', async (event, userId: number, shiftStart: string, shiftEnd: string | null, businessId: number = 14) => {
    if (!localDb) return {
      cash_shift: 0,
      cash_whole_day: 0
    };
    
    try {
      // Get cash payment method ID
      const cashMethodStmt = localDb.prepare('SELECT id FROM payment_methods WHERE code = ? LIMIT 1');
      const cashMethod = cashMethodStmt.get('cash') as { id: number } | undefined;
      
      if (!cashMethod) {
        return { cash_shift: 0, cash_whole_day: 0 };
      }
      
      // Cash received during shift
      let shiftQuery = `
        SELECT COALESCE(SUM(final_amount), 0) as cash_total
        FROM transactions t
        WHERE t.user_id = ? AND t.business_id = ?
        AND datetime(t.created_at) >= datetime(?)
        AND t.payment_method_id = ?
        AND t.status = 'completed'
      `;
      const shiftParams: QueryParams = [userId, businessId, shiftStart, cashMethod.id];
      
      if (shiftEnd) {
        shiftQuery += ' AND datetime(t.created_at) <= datetime(?)';
        shiftParams.push(shiftEnd);
      }
      
      const shiftStmt = localDb.prepare(shiftQuery);
      const shiftResult = shiftStmt.get(...shiftParams) as { cash_total: number };
      
      // Cash received whole day (GMT+7 - extract date from shift_start)
      // shiftStart is in UTC (ISO format)
      // We need to find the GMT+7 day boundaries
      const shiftDate = new Date(shiftStart);
      const gmt7Offset = 7 * 60 * 60 * 1000; // +7 hours in milliseconds
      
      // Convert to GMT+7 time
      const gmt7Time = new Date(shiftDate.getTime() + gmt7Offset);
      const year = gmt7Time.getUTCFullYear();
      const month = gmt7Time.getUTCMonth();
      const day = gmt7Time.getUTCDate();
      
      // Create day boundaries in GMT+7 (00:00:00 and 23:59:59.999)
      const dayStartGMT7 = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
      const dayEndGMT7 = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
      
      // Convert back to UTC for SQLite queries (subtract GMT+7 offset)
      const dayStart = new Date(dayStartGMT7.getTime() - gmt7Offset);
      const dayEnd = new Date(dayEndGMT7.getTime() - gmt7Offset);
      
      const wholeDayStmt = localDb.prepare(`
        SELECT COALESCE(SUM(final_amount), 0) as cash_total
        FROM transactions t
        WHERE t.business_id = ?
        AND datetime(t.created_at) >= datetime(?)
        AND datetime(t.created_at) <= datetime(?)
        AND t.payment_method_id = ?
        AND t.status = 'completed'
      `);
      
      const wholeDayResult = wholeDayStmt.get(
        businessId,
        dayStart.toISOString(),
        dayEnd.toISOString(),
        cashMethod.id
      ) as { cash_total: number };

      let refundShiftQuery = `
        SELECT COALESCE(SUM(cash_delta), 0) as refund_total
        FROM transaction_refunds
        WHERE refunded_by = ? AND business_id = ?
        AND datetime(refunded_at) >= datetime(?)
        AND status != 'failed'
      `;
      const refundShiftParams: QueryParams = [userId, businessId, shiftStart];
      if (shiftEnd) {
        refundShiftQuery += ' AND datetime(refunded_at) <= datetime(?)';
        refundShiftParams.push(shiftEnd);
      }
      const refundShiftStmt = localDb.prepare(refundShiftQuery);
      const refundShiftResult = refundShiftStmt.get(...refundShiftParams) as { refund_total: number };

      const dayRefundStmt = localDb.prepare(`
        SELECT COALESCE(SUM(cash_delta), 0) as refund_total
        FROM transaction_refunds
        WHERE business_id = ?
        AND datetime(refunded_at) >= datetime(?)
        AND datetime(refunded_at) <= datetime(?)
        AND status != 'failed'
      `);
      const dayRefundResult = dayRefundStmt.get(
        businessId,
        dayStart.toISOString(),
        dayEnd.toISOString()
      ) as { refund_total: number };

      const shiftSales = shiftResult.cash_total || 0;
      const shiftRefunds = refundShiftResult?.refund_total || 0;
      const daySales = wholeDayResult.cash_total || 0;
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

  // Get shifts with filtering - REMOVED DUPLICATE HANDLER
  // The new handler is defined above with pagination support
  /* 
  ipcMain.handle('localdb-get-shifts', async (event, filters: { businessId?: number; startDate?: string; endDate?: string; userId?: number; limit?: number } = {}) => {
    // ... implementation ...
  });
  */

  // Get unsynced shifts
  ipcMain.handle('localdb-get-unsynced-shifts', async (event, businessId?: number) => {
    if (!localDb) return [];
    try {
      let query = 'SELECT * FROM shifts WHERE synced_at IS NULL';
      const params: QueryParams = [];
      
      if (businessId) {
        query += ' AND business_id = ?';
        params.push(businessId);
      }
      
      query += ' ORDER BY created_at ASC';
      
      const stmt = localDb.prepare(query);
      return stmt.all(...params);
    } catch (error) {
      console.error('Error getting unsynced shifts:', error);
      return [];
    }
  });

  // Mark shifts as synced
  ipcMain.handle('localdb-mark-shifts-synced', async (event, shiftIds: number[]) => {
    if (!localDb || shiftIds.length === 0) return { success: true };
    try {
      const placeholders = shiftIds.map(() => '?').join(',');
      const stmt = localDb.prepare(`UPDATE shifts SET synced_at = ? WHERE id IN (${placeholders})`);
      stmt.run(Date.now(), ...shiftIds);
      return { success: true };
    } catch (error) {
      console.error('Error marking shifts as synced:', error);
      return { success: false };
    }
  });

  // Check for transactions before shift start (today)
  ipcMain.handle('localdb-check-today-transactions', async (event, userId: number, shiftStart: string, businessId: number = 14) => {
    if (!localDb) return { hasTransactions: false, count: 0, earliestTime: null };
    
    try {
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
      const checkStmt = localDb.prepare(`
        SELECT COUNT(*) as count, MIN(created_at) as earliest_time
        FROM transactions
        WHERE user_id = ? 
        AND business_id = ?
        AND datetime(created_at) >= datetime(?)
        AND datetime(created_at) < datetime(?)
        AND status = 'completed'
        AND (shift_uuid IS NULL OR shift_uuid = '')
      `);
      
      const result = checkStmt.get(userId, businessId, dayStart.toISOString(), shiftStart) as { count: number; earliest_time: string | null };
      
      return {
        hasTransactions: (result.count || 0) > 0,
        count: result.count || 0,
        earliestTime: result.earliest_time
      };
    } catch (error) {
      console.error('Error checking today transactions:', error);
      return { hasTransactions: false, count: 0, earliestTime: null };
    }
  });

  // Update shift start time to include earlier transactions
  ipcMain.handle('localdb-update-shift-start', async (event, shiftId: number, newStartTime: string) => {
    if (!localDb) return { success: false, error: 'Database not available' };
    
    try {
      // 1. Get shift details first to have the UUID and User ID
      const getShiftStmt = localDb.prepare('SELECT uuid_id, user_id FROM shifts WHERE id = ?');
      const shift = getShiftStmt.get(shiftId) as { uuid_id: string, user_id: number } | undefined;

      if (!shift) {
        return { success: false, error: 'Shift not found' };
      }

      // 2. Update the shift start time
      const stmt = localDb.prepare(`
        UPDATE shifts 
        SET shift_start = ?, updated_at = ?
        WHERE id = ? AND status = 'active'
      `);
      
      const result = stmt.run(newStartTime, Date.now(), shiftId);
      
      if (result.changes === 0) {
        return { success: false, error: 'Shift not found or not active' };
      }

      // 3. Link the transactions in the new time range to this shift
      const linkStmt = localDb.prepare(`
        UPDATE transactions
        SET shift_uuid = ?
        WHERE user_id = ? 
        AND datetime(created_at) >= datetime(?)
        AND (shift_uuid IS NULL OR shift_uuid = '')
      `);

      const linkResult = linkStmt.run(shift.uuid_id, shift.user_id, newStartTime);
      
      console.log(`✅ [SHIFTS] Updated shift ${shiftId} start time to ${newStartTime}`);
      console.log(`🔗 [SHIFTS] Linked ${linkResult.changes} transactions to shift ${shift.uuid_id}`);
      
      return { success: true };
    } catch (error) {
      console.error('Error updating shift start time:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get product sales breakdown for shift
  ipcMain.handle('localdb-get-product-sales', async (event, userId: number, shiftStart: string, shiftEnd: string | null, businessId: number = 14) => {
    if (!localDb) return { products: [], customizations: [] };
    
    try {
      let query = `
        SELECT 
          ti.id,
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
          p.harga_tiktok
        FROM transaction_items ti
        INNER JOIN transactions t ON ti.transaction_id = t.id
        LEFT JOIN payment_methods pm ON t.payment_method_id = pm.id
        INNER JOIN products p ON ti.product_id = p.id
        WHERE t.user_id = ?
        AND t.business_id = ?
        AND datetime(t.created_at) >= datetime(?)
        AND t.status = 'completed'
      `;
      const params: QueryParams = [userId, businessId, shiftStart];
      
      if (shiftEnd) {
        query += ' AND datetime(t.created_at) <= datetime(?)';
        params.push(shiftEnd);
      }
      
      const stmt = localDb.prepare(query);
      const rows = stmt.all(...params) as TransactionItemRow[];

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

      const sumCustomizationForRow = (row: TransactionItemRow, unitQuantity: number): number => {
        let customizationTotal = 0;

        // Read from normalized tables instead of JSON
        const customizations = readCustomizationsFromNormalizedTables(localDb!, row.id as string, null);
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
        const customizationSubtotal = sumCustomizationForRow(row, quantity);
        let baseSubtotal = totalPrice - customizationSubtotal;

        if (baseSubtotal < 0) {
          baseSubtotal = 0;
        }

        // Determine platform based on product price, not payment method
        const platformCode = determinePlatform(row);
        const transactionType = row.transaction_type || 'drinks';
        const key = `${row.product_id}-${platformCode}-${transactionType}`;

        const existing = aggregate.get(key);

        if (existing) {
          existing.total_quantity += quantity;
          existing.total_subtotal += totalPrice;
          existing.customization_subtotal += customizationSubtotal;
          existing.base_subtotal += baseSubtotal;
        } else {
          aggregate.set(key, {
            product_id: Number(row.product_id),
            product_name: row.product_name,
            product_code: row.product_code,
            platform: platformCode,
            transaction_type: transactionType,
            total_quantity: quantity,
            total_subtotal: totalPrice,
            customization_subtotal: customizationSubtotal,
            base_subtotal: baseSubtotal,
          });
        }
      }

      const regularProducts = Array.from(aggregate.values()).map(product => {
        const quantity = product.total_quantity || 0;
        const baseSubtotal = product.base_subtotal || 0;
        const baseUnitPrice = quantity > 0 ? baseSubtotal / quantity : 0;
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
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: RowArray) => {
      const stmt = localDb!.prepare(`INSERT INTO payment_methods (
        id, name, code, description, is_active, requires_additional_info, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, code=excluded.code, description=excluded.description,
        is_active=excluded.is_active, requires_additional_info=excluded.requires_additional_info,
        created_at=excluded.created_at, updated_at=excluded.updated_at`);
      for (const r of data) {
        stmt.run(r.id, r.name, r.code, r.description, r.is_active || 1, r.requires_additional_info || 0, r.created_at, Date.now());
      }
    });
    tx(rows);
    return { success: true };
  });

  ipcMain.handle('localdb-get-payment-methods', async () => {
    if (!localDb) return [];
    const stmt = localDb.prepare('SELECT * FROM payment_methods WHERE is_active = 1 ORDER BY name ASC');
    return stmt.all();
  });

  // Banks
  ipcMain.handle('localdb-upsert-banks', async (event, rows: RowArray) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: RowArray) => {
      const stmt = localDb!.prepare(`INSERT INTO banks (
        id, bank_code, bank_name, is_popular, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        bank_code=excluded.bank_code, bank_name=excluded.bank_name, is_popular=excluded.is_popular,
        is_active=excluded.is_active, created_at=excluded.created_at`);
      for (const r of data) {
        stmt.run(r.id, r.bank_code, r.bank_name, r.is_popular || 0, r.is_active || 1, r.created_at);
      }
    });
    tx(rows);
    return { success: true };
  });

  ipcMain.handle('localdb-get-banks', async () => {
    if (!localDb) return [];
    const stmt = localDb.prepare('SELECT * FROM banks WHERE is_active = 1 ORDER BY is_popular DESC, bank_name ASC');
    return stmt.all();
  });

  // Organizations
  ipcMain.handle('localdb-upsert-organizations', async (event, rows: RowArray) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: RowArray) => {
      const stmt = localDb!.prepare(`INSERT INTO organizations (
        id, name, slug, owner_user_id, subscription_status, subscription_plan,
        trial_ends_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, slug=excluded.slug, owner_user_id=excluded.owner_user_id,
        subscription_status=excluded.subscription_status, subscription_plan=excluded.subscription_plan,
        trial_ends_at=excluded.trial_ends_at, created_at=excluded.created_at, updated_at=excluded.updated_at`);
      for (const r of data) {
        stmt.run(r.id, r.name, r.slug, r.owner_user_id, r.subscription_status || 'trial', 
                r.subscription_plan || 'basic', r.trial_ends_at, r.created_at, Date.now());
      }
    });
    tx(rows);
    return { success: true };
  });

  ipcMain.handle('localdb-get-organizations', async () => {
    if (!localDb) return [];
    const stmt = localDb.prepare('SELECT * FROM organizations ORDER BY name ASC');
    return stmt.all();
  });

  // Management Groups
  ipcMain.handle('localdb-upsert-management-groups', async (event, rows: RowArray) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: RowArray) => {
      const stmt = localDb!.prepare(`INSERT INTO management_groups (
        id, name, permission_name, description, organization_id, manager_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, permission_name=excluded.permission_name, description=excluded.description,
        organization_id=excluded.organization_id, manager_user_id=excluded.manager_user_id,
        created_at=excluded.created_at, updated_at=excluded.updated_at`);
      for (const r of data) {
        stmt.run(r.id, r.name, r.permission_name, r.description, r.organization_id, r.manager_user_id, r.created_at, Date.now());
      }
    });
    tx(rows);
    return { success: true };
  });

  ipcMain.handle('localdb-get-management-groups', async () => {
    if (!localDb) return [];
    const stmt = localDb.prepare('SELECT * FROM management_groups ORDER BY name ASC');
    return stmt.all();
  });

  ipcMain.handle('localdb-check-exists', async () => {
    try {
      const dbPath = getLocalDbPath();
      const exists = fs.existsSync(dbPath);
      return { exists, path: dbPath };
    } catch (error) {
      console.error('Error checking local DB existence:', error);
      return { exists: false, error: String(error) };
    }
  });

  // Category1
  ipcMain.handle('localdb-upsert-category1', async (event, rows: RowArray) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: RowArray) => {
      const stmt = localDb!.prepare(`INSERT INTO category1 (
        id, name, description, display_order, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, description=excluded.description, display_order=excluded.display_order,
        is_active=excluded.is_active, created_at=excluded.created_at, updated_at=excluded.updated_at`);
      for (const r of data) {
        stmt.run(r.id, r.name, r.description, r.display_order || 0, r.is_active || 1, r.created_at, Date.now());
      }
    });
    tx(rows);
    return { success: true };
  });

  ipcMain.handle('localdb-get-category1', async () => {
    if (!localDb) return [];
    const stmt = localDb.prepare('SELECT * FROM category1 WHERE is_active = 1 ORDER BY display_order ASC, name ASC');
    return stmt.all();
  });

  // Category2
  ipcMain.handle('localdb-upsert-category2', async (event, rows: RowArray) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: RowArray) => {
      const stmt = localDb!.prepare(`INSERT INTO category2 (
        id, name, business_id, description, display_order, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, business_id=excluded.business_id, description=excluded.description,
        display_order=excluded.display_order, is_active=excluded.is_active,
        created_at=excluded.created_at, updated_at=excluded.updated_at`);
      for (const r of data) {
        stmt.run(r.id, r.name, r.business_id, r.description, r.display_order || 0, r.is_active || 1, r.created_at, Date.now());
      }
    });
    tx(rows);
    return { success: true };
  });

  ipcMain.handle('localdb-get-category2', async (event, businessId?: number) => {
    if (!localDb) return [];
    if (businessId) {
      const stmt = localDb.prepare('SELECT * FROM category2 WHERE business_id = ? AND is_active = 1 ORDER BY display_order ASC, name ASC');
      return stmt.all(businessId);
    } else {
      const stmt = localDb.prepare('SELECT * FROM category2 WHERE is_active = 1 ORDER BY display_order ASC, name ASC');
      return stmt.all();
    }
  });

  // CL Accounts
  ipcMain.handle('localdb-upsert-cl-accounts', async (event, rows: RowArray) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: RowArray) => {
      const stmt = localDb!.prepare(`INSERT INTO cl_accounts (
        id, account_code, account_name, contact_info, credit_limit, current_balance,
        is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        account_code=excluded.account_code, account_name=excluded.account_name, contact_info=excluded.contact_info,
        credit_limit=excluded.credit_limit, current_balance=excluded.current_balance,
        is_active=excluded.is_active, created_at=excluded.created_at, updated_at=excluded.updated_at`);
      for (const r of data) {
        stmt.run(r.id, r.account_code, r.account_name, r.contact_info, r.credit_limit || 0.0, 
                r.current_balance || 0.0, r.is_active || 1, r.created_at, Date.now());
      }
    });
    tx(rows);
    return { success: true };
  });

  ipcMain.handle('localdb-get-cl-accounts', async () => {
    if (!localDb) return [];
    const stmt = localDb.prepare('SELECT * FROM cl_accounts WHERE is_active = 1 ORDER BY account_name ASC');
    return stmt.all();
  });


  // Printer configuration handlers
ipcMain.handle('localdb-save-printer-config', async (event, printerType: string, systemPrinterName: string, extraSettings?: UnknownRecord | string | null) => {
    if (!localDb) return { success: false };
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
      
      const stmt = localDb.prepare(`INSERT INTO printer_configs (id, printer_type, system_printer_name, extra_settings, created_at, updated_at) 
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET 
        system_printer_name=excluded.system_printer_name,
        extra_settings=excluded.extra_settings,
        updated_at=excluded.updated_at`);
      const now = Date.now();
      stmt.run(printerType, printerType, systemPrinterName, extraSettingsJson, now, now);
      return { success: true };
    } catch (error) {
      console.error('Error saving printer config:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('localdb-get-printer-configs', async () => {
    if (!localDb) return [];
    try {
      const stmt = localDb.prepare('SELECT * FROM printer_configs ORDER BY printer_type ASC');
      return stmt.all();
    } catch (error) {
      console.error('Error getting printer configs:', error);
      return [];
    }
  });

  // ==================== PRINTER MANAGEMENT IPC HANDLERS ====================
  
  // Generate 19-digit numeric UUID
  ipcMain.handle('generate-numeric-uuid', async (event, businessId: number) => {
    if (!printerService) return { success: false, error: 'Printer service not available' };
    try {
      const uuid = printerService.generateNumericUUID(businessId);
      return { success: true, uuid };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
  
  // Get or increment printer counter
  ipcMain.handle('get-printer-counter', async (event, printerType: string, businessId: number, increment: boolean = false) => {
    if (!printerService) return { success: false, counter: 0 };
    try {
      const counter = printerService.getPrinterCounter(printerType, businessId, increment);
      return { success: true, counter };
    } catch (error) {
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
    const result = printerService.logPrinter2Print(transactionId, printer2ReceiptNumber, mode, cycleNumber, globalCounter, isReprint, reprintCount);
    return { success: result };
  });
  
  // Get Printer 2 audit log
  ipcMain.handle('get-printer2-audit-log', async (event, fromDate?: string, toDate?: string, limit?: number) => {
    if (!printerService) return { success: false, entries: [] };
    const entries = printerService.getPrinter2AuditLog(fromDate, toDate, limit || 100);
    return { success: true, entries };
  });

  // Log Printer 1 print
  ipcMain.handle('log-printer1-print', async (event, transactionId: string, printer1ReceiptNumber: number, globalCounter?: number, isReprint?: boolean, reprintCount?: number) => {
    if (!printerService) return { success: false };
    const result = printerService.logPrinter1Print(transactionId, printer1ReceiptNumber, globalCounter, isReprint, reprintCount);
    return { success: result };
  });

  // Get Printer 1 audit log
  ipcMain.handle('get-printer1-audit-log', async (event, fromDate?: string, toDate?: string, limit?: number) => {
    if (!printerService) return { success: false, entries: [] };
    const entries = printerService.getPrinter1AuditLog(fromDate, toDate, limit || 100);
    return { success: true, entries };
  });

  // Get unsynced printer audits (both tables)
  ipcMain.handle('localdb-get-unsynced-printer-audits', async () => {
    if (!localDb) return { p1: [], p2: [] };
    try {
      const p1 = localDb.prepare('SELECT id, transaction_id, printer1_receipt_number, global_counter, printed_at, printed_at_epoch FROM printer1_audit_log WHERE synced_at IS NULL ORDER BY printed_at_epoch ASC LIMIT 1000').all();
      const p2 = localDb.prepare('SELECT id, transaction_id, printer2_receipt_number, print_mode, cycle_number, global_counter, printed_at, printed_at_epoch FROM printer2_audit_log WHERE synced_at IS NULL ORDER BY printed_at_epoch ASC LIMIT 1000').all();
      return { p1, p2 };
    } catch (error) {
      console.error('Error fetching unsynced printer audits:', error);
      return { p1: [], p2: [] };
    }
  });

  // Mark printer audits as synced
  ipcMain.handle('localdb-mark-printer-audits-synced', async (event, ids: { p1Ids: number[]; p2Ids: number[] }) => {
    if (!localDb) return { success: false };
    try {
      const now = Date.now();
      if (ids?.p1Ids?.length) {
        const placeholders = ids.p1Ids.map(() => '?').join(',');
        localDb.prepare(`UPDATE printer1_audit_log SET synced_at = ? WHERE id IN (${placeholders})`).run(now, ...ids.p1Ids);
      }
      if (ids?.p2Ids?.length) {
        const placeholders = ids.p2Ids.map(() => '?').join(',');
        localDb.prepare(`UPDATE printer2_audit_log SET synced_at = ? WHERE id IN (${placeholders})`).run(now, ...ids.p2Ids);
      }
      return { success: true };
    } catch (error) {
      console.error('Error marking printer audits synced:', error);
      return { success: false };
    }
  });

  // Upsert printer audit logs downloaded from cloud
  ipcMain.handle('localdb-upsert-printer-audits', async (event, payload: { printerType: 'receipt' | 'receiptize'; rows: RowArray }) => {
    if (!localDb) return { success: false };
    if (!payload?.rows?.length) return { success: true, count: 0 };

    const now = Date.now();
    const { printerType, rows } = payload;

    try {
      const tx = localDb.transaction((data: RowArray) => {
        if (printerType === 'receipt') {
          const deleteStmt = localDb!.prepare('DELETE FROM printer1_audit_log WHERE transaction_id = ? AND printer1_receipt_number = ? AND printed_at_epoch = ?');
          const insertStmt = localDb!.prepare(`
            INSERT INTO printer1_audit_log (transaction_id, printer1_receipt_number, global_counter, printed_at, printed_at_epoch, synced_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `);
          for (const row of data) {
            const transactionId = String(row.transaction_id);
            const receiptNumber = Number(row.printer1_receipt_number);
            const parsePrintedAt = (value: unknown): number => {
              if (typeof value === 'string' || typeof value === 'number') {
                const date = new Date(value);
                if (!Number.isNaN(date.getTime())) {
                  return date.getTime();
                }
              }
              return 0;
            };
            const printedAtEpoch = Number(row.printed_at_epoch ?? parsePrintedAt(row.printed_at));
            if (!transactionId || Number.isNaN(receiptNumber) || Number.isNaN(printedAtEpoch)) {
              continue;
            }
            deleteStmt.run(transactionId, receiptNumber, printedAtEpoch);
            insertStmt.run(
              transactionId,
              receiptNumber,
              typeof row.global_counter === 'number' ? row.global_counter : null,
              row.printed_at ?? new Date(printedAtEpoch).toISOString(),
              printedAtEpoch,
              now
            );
          }
        } else {
          const deleteStmt = localDb!.prepare('DELETE FROM printer2_audit_log WHERE transaction_id = ? AND printer2_receipt_number = ? AND printed_at_epoch = ?');
          const insertStmt = localDb!.prepare(`
            INSERT INTO printer2_audit_log (transaction_id, printer2_receipt_number, print_mode, cycle_number, global_counter, printed_at, printed_at_epoch, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const row of data) {
            const transactionId = String(row.transaction_id);
            const receiptNumber = Number(row.printer2_receipt_number);
            const parsePrintedAt = (value: unknown): number => {
              if (typeof value === 'string' || typeof value === 'number') {
                const date = new Date(value);
                if (!Number.isNaN(date.getTime())) {
                  return date.getTime();
                }
              }
              return 0;
            };
            const printedAtEpoch = Number(row.printed_at_epoch ?? parsePrintedAt(row.printed_at));
            if (!transactionId || Number.isNaN(receiptNumber) || Number.isNaN(printedAtEpoch)) {
              continue;
            }
            deleteStmt.run(transactionId, receiptNumber, printedAtEpoch);
            insertStmt.run(
              transactionId,
              receiptNumber,
              row.print_mode ?? 'manual',
              row.cycle_number ?? null,
              typeof row.global_counter === 'number' ? row.global_counter : null,
              row.printed_at ?? new Date(printedAtEpoch).toISOString(),
              printedAtEpoch,
              now
            );
          }
        }
      });

      tx(rows);
      return { success: true, count: rows.length };
    } catch (error) {
      console.error('Error upserting printer audits:', error);
      return { success: false, error: String(error) };
    }
  });

  // Upsert printer daily counters downloaded from cloud
  ipcMain.handle('localdb-upsert-printer-daily-counters', async (event, counters: Array<{ printer_type: string; business_id: number; date: string; counter: number }>) => {
    if (!localDb) return { success: false };
    if (!Array.isArray(counters) || counters.length === 0) {
      return { success: true, count: 0 };
    }

    try {
      const tx = localDb.transaction((rows: Array<{ printer_type: string; business_id: number; date: string; counter: number }>) => {
        const stmt = localDb!.prepare(`
          INSERT INTO printer_daily_counters (printer_type, business_id, date, counter, last_reset_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(printer_type, business_id, date)
          DO UPDATE SET counter = excluded.counter, last_reset_at = excluded.last_reset_at
        `);

        const now = Date.now();
        for (const row of rows) {
          if (!row?.printer_type || !row?.date) continue;
          const counterValue = Number(row.counter ?? 0);
          stmt.run(row.printer_type, Number(row.business_id ?? 0), row.date, counterValue, now);
        }
      });

      tx(counters);
      return { success: true, count: counters.length };
    } catch (error) {
      console.error('Error upserting printer counters:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('localdb-reset-printer-daily-counters', async (event, businessId: number) => {
    if (!localDb) return { success: false };
    try {
      const stmt = localDb.prepare(`
        DELETE FROM printer_daily_counters
        WHERE business_id = ?
      `);
      stmt.run(businessId);
      console.log(`🧹 [RESET] Cleared printer_daily_counters for business ${businessId}`);
      return { success: true };
    } catch (error) {
      console.error('❌ [RESET] Failed to clear printer_daily_counters:', error);
      return { success: false, error: String(error) };
    }
  });

  // Offline transaction queue management
  ipcMain.handle('localdb-queue-offline-transaction', async (event, transactionData: UnknownRecord) => {
    if (!localDb) return { success: false, error: 'Database not available' };
    try {
      // Try to link to an active shift if not already provided
      if (!transactionData.shift_uuid && transactionData.user_id) {
        try {
          const shiftStmt = localDb.prepare(`
            SELECT uuid_id 
            FROM shifts 
            WHERE user_id = ? AND status = 'active' AND business_id = ?
            ORDER BY shift_start DESC 
            LIMIT 1
          `);
          const activeShift = shiftStmt.get(transactionData.user_id, transactionData.business_id ?? 14) as { uuid_id: string } | undefined;
          if (activeShift) {
            transactionData.shift_uuid = activeShift.uuid_id;
            console.log(`🔗 Linking offline transaction to shift ${activeShift.uuid_id}`);
          } else {
            console.warn(`⚠️ No active shift found for user ${transactionData.user_id} when queuing transaction`);
          }
        } catch (shiftError) {
          console.error('Error finding active shift for offline transaction:', shiftError);
        }
      }

      const stmt = localDb.prepare(`
        INSERT INTO offline_transactions (transaction_data, created_at, sync_status)
        VALUES (?, ?, 'pending')
      `);
      const result = stmt.run(JSON.stringify(transactionData), Date.now());
      
      // Queue transaction items
      const items = Array.isArray(transactionData.items) ? transactionData.items : [];
      if (items.length > 0) {
        const itemStmt = localDb.prepare(`
          INSERT INTO offline_transaction_items (offline_transaction_id, item_data)
          VALUES (?, ?)
        `);
        for (const item of items) {
          itemStmt.run(result.lastInsertRowid, JSON.stringify(item));
        }
      }
      
      console.log(`✅ Queued offline transaction ${result.lastInsertRowid}`);
      return { success: true, offlineTransactionId: result.lastInsertRowid };
    } catch (error) {
      console.error('Error queueing offline transaction:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('localdb-get-pending-transactions', async () => {
    if (!localDb) return [];
    try {
      const stmt = localDb.prepare(`
        SELECT id, transaction_data, created_at, sync_attempts, last_sync_attempt
        FROM offline_transactions 
        WHERE sync_status = 'pending' 
        ORDER BY created_at ASC
        LIMIT 50
      `);
      const transactions = stmt.all() as Array<{
        id: number;
        transaction_data: string;
        created_at: number;
        sync_attempts: number;
        last_sync_attempt?: number;
      }>;
      
      // Fetch items for each transaction and include them
      const transactionsWithItems = transactions.map(transaction => {
        try {
          const transactionData = JSON.parse(transaction.transaction_data);
          
          // Fetch items for this transaction
          if (!localDb) {
            // If localDb becomes null, return transaction without items
            return transaction;
          }
          
          const itemsStmt = localDb.prepare(`
            SELECT item_data
            FROM offline_transaction_items
            WHERE offline_transaction_id = ?
            ORDER BY id ASC
          `);
          const items = itemsStmt.all(transaction.id) as Array<{ item_data: string }>;
          
          // Parse and include items in transaction data
          transactionData.items = items.map(item => JSON.parse(item.item_data));
          
          return {
            ...transaction,
            transaction_data: JSON.stringify(transactionData)
          };
        } catch (error) {
          console.error(`Error processing transaction ${transaction.id}:`, error);
          // Return transaction without items if parsing fails
          return transaction;
        }
      });
      
      return transactionsWithItems;
    } catch (error) {
      console.error('Error getting pending transactions:', error);
      return [];
    }
  });

  ipcMain.handle('localdb-mark-transaction-synced', async (event, offlineTransactionId: number) => {
    if (!localDb) return { success: false };
    try {
      const stmt = localDb.prepare(`
        UPDATE offline_transactions 
        SET sync_status = 'synced', last_sync_attempt = ?
        WHERE id = ?
      `);
      stmt.run(Date.now(), offlineTransactionId);
      return { success: true };
    } catch (error) {
      console.error('Error marking transaction as synced:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('localdb-mark-transaction-failed', async (event, offlineTransactionId: number) => {
    if (!localDb) return { success: false };
    try {
      const stmt = localDb.prepare(`
        UPDATE offline_transactions 
        SET sync_attempts = sync_attempts + 1, last_sync_attempt = ?
        WHERE id = ?
      `);
      stmt.run(Date.now(), offlineTransactionId);
      return { success: true };
    } catch (error) {
      console.error('Error marking transaction as failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('localdb-queue-offline-refund', async (event, refundData: UnknownRecord) => {
    if (!localDb) return { success: false, error: 'Database not available' };
    try {
      const stmt = localDb.prepare(`
        INSERT INTO offline_refunds (refund_data, created_at, sync_status, sync_attempts)
        VALUES (?, ?, 'pending', 0)
      `);
      const result = stmt.run(JSON.stringify(refundData), Date.now());
      return { success: true, offlineRefundId: Number(result.lastInsertRowid) };
    } catch (error) {
      console.error('Error queueing offline refund:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('localdb-get-pending-refunds', async () => {
    if (!localDb) return [];
    try {
      const stmt = localDb.prepare(`
        SELECT id, refund_data, created_at, sync_attempts, last_sync_attempt
        FROM offline_refunds
        WHERE sync_status = 'pending'
        ORDER BY created_at ASC
        LIMIT 50
      `);
      return stmt.all();
    } catch (error) {
      console.error('Error getting pending refunds:', error);
      return [];
    }
  });

  ipcMain.handle('localdb-mark-refund-synced', async (event, offlineRefundId: number) => {
    if (!localDb) return { success: false };
    try {
      const stmt = localDb.prepare(`
        UPDATE offline_refunds
        SET sync_status = 'synced', last_sync_attempt = ?
        WHERE id = ?
      `);
      stmt.run(Date.now(), offlineRefundId);
      return { success: true };
    } catch (error) {
      console.error('Error marking refund as synced:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('localdb-mark-refund-failed', async (event, offlineRefundId: number) => {
    if (!localDb) return { success: false };
    try {
      const stmt = localDb.prepare(`
        UPDATE offline_refunds
        SET sync_attempts = sync_attempts + 1, last_sync_attempt = ?
        WHERE id = ?
      `);
      stmt.run(Date.now(), offlineRefundId);
      return { success: true };
    } catch (error) {
      console.error('Error marking refund as failed:', error);
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
          console.log(`✅ Successfully loaded login page on port ${port}`);
          return true;
        } catch (error) {
          console.log(`❌ Failed to load on port ${port}:`, error);
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
        console.error('❌ Failed to load on any port');
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
  try {
    console.log('📄 Printing receipt - Full data received:', JSON.stringify(data, null, 2));
    
    let printerName = data.printerName;
    let marginAdjustMm: number | undefined =
      typeof data.marginAdjustMm === 'number' && !Number.isNaN(data.marginAdjustMm)
        ? data.marginAdjustMm
        : undefined;
    let printerConfig: PrinterConfigRow | null = null;
    
    if (data.printerType && localDb) {
      console.log('🔍 Resolving printer configuration for type:', data.printerType);
      try {
        const allConfigs = localDb.prepare('SELECT * FROM printer_configs').all() as PrinterConfigRow[];
        console.log('📋 All printer configs in database:', allConfigs);
        
        printerConfig = (localDb.prepare('SELECT * FROM printer_configs WHERE printer_type = ?')
          .get(data.printerType) as PrinterConfigRow | undefined) ?? null;
        console.log('📋 Printer config query result for type', data.printerType, ':', printerConfig);
        
        if (!printerName && printerConfig && printerConfig.system_printer_name) {
          printerName = printerConfig.system_printer_name;
          console.log('✅ Found saved printer:', printerName);
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
          console.log('⚠️ No system printer configured for type:', data.printerType);
          console.log('💡 Available printer configs:', allConfigs.map(c => ({ type: c.printer_type, name: c.system_printer_name })));
          return { success: false, error: 'No printer configured. Please set up a printer in Settings.' };
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
    
    // Still no printer name? Try fallback to printerType as printer name
    if (!printerName) {
      printerName = data.printerType;
      console.log('⚠️ Using printerType as fallback printer name:', printerName);
    }
    
    if (!printerName) {
      console.error('❌ No printer name or type provided in data:', data);
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
    let businessName = 'MARVIANO MADIUN 1'; // Default fallback
    if (data.business_id && localDb) {
      try {
        const business = localDb.prepare('SELECT name FROM businesses WHERE id = ?').get(data.business_id) as { name: string } | undefined;
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
    
    if (data.type === 'test') {
      // Check if this is for a label printer
      if (data.printerType === 'labelPrinter') {
        htmlContent = generateTestLabelHTML(printerName);
      } else {
        htmlContent = generateTestReceiptHTML(printerName, businessName, receiptFormattingOptions);
      }
    } else {
      htmlContent = generateReceiptHTML(data, businessName, receiptFormattingOptions);
    }
    
    await printWindow.loadURL(`data:text/html,${encodeURIComponent(htmlContent)}`);
    
    const printOptions = {
      silent: true,
      printBackground: false,
      deviceName: printerName,
    };
    
    return new Promise((resolve) => {
      const currentWindow = printWindow;
      setTimeout(() => {
        try {
          if (!currentWindow || currentWindow.isDestroyed()) {
            console.error('❌ Print window not available when attempting to print');
            resolve({ success: false, error: 'Print window unavailable' });
            return;
          }

          currentWindow.webContents.print(printOptions, (success: boolean, errorType: string) => {
            if (success) {
              console.log('✅ Print sent successfully');
              resolve({ success: true });
            } else {
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

// IPC handler for printing labels
ipcMain.handle('print-label', async (event, data: LabelPrintData) => {
  try {
    console.log('🏷️ Printing label - Full data received:', JSON.stringify(data, null, 2));
    
    let printerName = data.printerName;
    
    // If printer name is not specified, try to get it from saved config
    if (!printerName) {
      if (!data.printerType) {
        console.error('❌ No printer type provided!');
        return { success: false, error: 'No printer specified.' };
      }
      
      if (!localDb) {
        console.error('❌ Local database not available!');
        return { success: false, error: 'Database not available.' };
      }
      
      console.log('🔍 No printer name specified, fetching from saved config for printer type:', data.printerType);
      
      // First, list all available configs for debugging
      try {
        const allConfigs = localDb.prepare('SELECT * FROM printer_configs').all() as PrinterConfigRow[];
        console.log('📋 All printer configs in database:', JSON.stringify(allConfigs, null, 2));
      } catch (e) {
        console.error('Failed to list all configs:', e);
      }
      
      try {
        const config = localDb.prepare('SELECT * FROM printer_configs WHERE printer_type = ?').get(data.printerType) as PrinterConfigRow | undefined;
        console.log('📋 Printer config query result for type', data.printerType, ':', JSON.stringify(config, null, 2));
        
        if (!config) {
          console.log('⚠️ No saved printer config found for type:', data.printerType);
          return { success: false, error: 'Label printer not configured. Please set up a valid printer in Settings.' };
        }
        
        if (!config.system_printer_name || config.system_printer_name.trim() === '') {
          console.log('⚠️ Printer config found but system_printer_name is empty:', config);
          return { success: false, error: 'Label printer not configured. Please set up a valid printer in Settings.' };
        }
        
        printerName = config.system_printer_name;
        console.log('✅ Found saved printer:', printerName);
      } catch (error) {
        console.error('❌ Error fetching printer config:', error);
        return { success: false, error: 'Error loading printer configuration.' };
      }
    }
    
    if (!printerName) {
      console.error('❌ No printer name provided!');
      return { success: false, error: 'No printer specified.' };
    }
    
    // Close existing print window if any
    if (printWindow) {
      printWindow.close();
    }
    
    // Create new print window
    printWindow = new BrowserWindow({
      width: 400,
      height: 600,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      }
    });
    
    // Generate label HTML
    const htmlContent = generateLabelHTML(data);
    
    await printWindow.loadURL(`data:text/html,${encodeURIComponent(htmlContent)}`);
    
    const printOptions = {
      silent: true,
      printBackground: false,
      deviceName: printerName,
    };
    
    return new Promise((resolve) => {
      const currentWindow = printWindow;
      setTimeout(() => {
        try {
          if (!currentWindow || currentWindow.isDestroyed()) {
            console.error('❌ Print window not available when attempting to print label');
            resolve({ success: false, error: 'Print window unavailable' });
            return;
          }

          currentWindow.webContents.print(printOptions, (success: boolean, errorType: string) => {
            if (success) {
              console.log('✅ Label sent successfully');
              resolve({ success: true });
            } else {
              console.error('❌ Label print failed:', errorType);
              resolve({ success: false, error: errorType });
            }
            setTimeout(() => {
              if (currentWindow && !currentWindow.isDestroyed()) {
                currentWindow.close();
              }
              if (printWindow === currentWindow) {
                printWindow = null;
              }
            }, 5000);
          });
        } catch (err) {
          console.error('❌ Exception during webContents.print:', err);
          resolve({ success: false, error: String(err) });
          setTimeout(() => {
            if (currentWindow && !currentWindow.isDestroyed()) {
              currentWindow.close();
            }
            if (printWindow === currentWindow) {
              printWindow = null;
            }
          }, 5000);
        }
      }, 500);
    });
  } catch (error) {
    console.error('❌ Error in print-label handler:', error);
    return { success: false, error: String(error) };
  }
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
}

// Generate test receipt HTML with character-based formatting
function generateTestReceiptHTML(printerName: string, businessName: string, options?: ReceiptFormattingOptions): string {
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
  
  // Use the full receipt format for test print with sample data
  const orderTime = formatDateTime(new Date());
  const printTime = formatDateTime(new Date());
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
    .footer { margin-top: 2mm; font-size: 8pt; text-align: left; line-height: 1.3; font-weight: 500; }
  </style>
</head>
<body>
  <div class="contact">silahkan hubungi: 0813-9888-8568</div>
  
  ${logoDataUri ? `<div class="logo-container"><img src="${logoDataUri}" class="logo" alt="Momoyo Logo"></div>` : '<div class="store-name">MOMOYO</div>'}
  <div class="branch">${businessName}</div>
  <div class="address">Jl. Kalimantan no. 21, Kartoharjo<br>Kec. Kartoharjo, Kota Madiun</div>
  
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
    <span class="info-label">Saluran:</span>
    <span class="info-value">Toko Offline</span>
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
  <div class="summary-line">
    <span class="summary-label">Nominal Pendapatan:</span>
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
    <p>Pendapat Anda sangat penting bagi kami.</p>
    <p>Untuk kritik dan saran silahkan hubungi :</p>
    <p>0812-1822-2666</p>
    <p style="margin-top: 2mm;">Untuk layanan kemitraan dan partnership</p>
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
    @page { size: 40mm auto; margin: 0; }
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

// Generate label HTML for order items
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
      size: 40mm auto; 
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
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 100%;
    }
    .content {
      flex: 1;
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
      margin-top: auto;
      padding-top: 2mm;
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

// Generate transaction receipt HTML
function generateReceiptHTML(data: ReceiptPrintData, businessName: string, options?: ReceiptFormattingOptions): string {
  const marginAdjust = options?.marginAdjustMm ?? 0;
  const baseLeftPadding = 7;
  const baseRightPadding = 7;
  const leftPadding = Math.max(0, baseLeftPadding - marginAdjust);
  const rightPadding = Math.max(0, baseRightPadding + marginAdjust);
  
  const items = data.items || [];
  const total = data.total || data.final_amount || 0;
  const paymentMethod = data.paymentMethod || 'Cash';
  const amountReceived = data.amountReceived || 0;
  const change = data.change || 0;
  
  // Calculate total items for summary
  const totalItems = items.reduce((sum: number, item: ReceiptLineItem) => sum + (item.quantity || 1), 0);
  
  // Generate items HTML
  const itemsHTML = items.map((item: ReceiptLineItem) => {
    // Handle both new format (name, quantity, price, total_price) and old format (product.nama, etc.)
    const name = item.name || item.product?.nama || '';
    const qty = item.quantity || 1;
    const price = item.price || item.unit_price || 0;
    const subtotal = item.total_price || (price * qty);
    
    return `
      <tr>
        <td colspan="4" style="text-align: left; padding-bottom: 0.5mm;">${name}</td>
      </tr>
      <tr>
        <td style="width: 30%;"></td>
        <td style="width: 25%; text-align: right; padding-top: 0;">${price.toLocaleString('id-ID')}</td>
        <td style="width: 20%; text-align: right; padding-top: 0;">${qty}</td>
        <td style="width: 25%; text-align: right; padding-top: 0;">${subtotal.toLocaleString('id-ID')}</td>
      </tr>
    `;
  }).join('');
  
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
    .footer { margin-top: 2mm; font-size: 8pt; text-align: left; line-height: 1.3; font-weight: 500; }
  </style>
</head>
<body>
  <div class="contact">silahkan hubungi: 0813-9888-8568</div>
  
  ${logoDataUri ? `<div class="logo-container"><img src="${logoDataUri}" class="logo" alt="Momoyo Logo"></div>` : '<div class="store-name">MOMOYO</div>'}
  <div class="branch">${businessName}</div>
  ${data.isReprint && data.reprintCount ? `<div class="reprint-notice" style="text-align: center; font-size: 10pt; font-weight: bold; margin: 1mm 0; color: #000;">REPRINT KE-${data.reprintCount}</div>` : ''}
  <div class="address">Jl. Kalimantan no. 21, Kartoharjo<br>Kec. Kartoharjo, Kota Madiun</div>
  
  ${(() => {
        // Choose per-printer display number: Each printer type uses its own daily counter
    // Printer 1 (receiptPrinter) uses printer1Counter from receiptPrinter counter
    // Printer 2 (receiptizePrinter) uses printer2Counter from receiptizePrinter counter
    // Fall back to globalCounter, then tableNumber, then '01'
    const isReceiptize = data.printerType === 'receiptizePrinter';
    // Prioritize per-printer counter over globalCounter to ensure each printer has its own counter
    const perPrinterCounter = isReceiptize ? data.printer2Counter : data.printer1Counter;
    const displayCounter = perPrinterCounter ?? data.globalCounter ?? data.tableNumber ?? '01';
    const numStr = String(displayCounter).padStart(2, '0');
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
    <span class="info-label">Saluran:</span>
    <span class="info-value">Toko Offline</span>
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
    <span class="summary-value">${total.toLocaleString('id-ID')}</span>
  </div>
  <div class="summary-line">
    <span class="summary-label">Nominal Pendapatan:</span>
    <span class="summary-value">${total.toLocaleString('id-ID')}</span>
  </div>
  
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
    <span class="summary-value">${total.toLocaleString('id-ID')}</span>
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
  shiftData: PrintableShiftReportSection & { businessName?: string; wholeDayReport?: PrintableShiftReportSection | null }
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
    options: { titleOverride?: string; businessName?: string } = {}
  ): string => {
    const sectionTitle = options.titleOverride || report.title || 'LAPORAN SHIFT';
    const businessName = options.businessName || shiftData.businessName || 'Momoyo Bakery Kalimantan';
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
        const unitPrice = product.base_unit_price ?? (quantity > 0 ? baseSubtotal / quantity : 0);
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
        <td style="text-align: right; padding: 0.3mm 0;">${quantity}</td>
        <td style="text-align: right; padding: 0.3mm 0;">${isBundleItem ? '-' : (isNaN(unitPrice) ? '0' : unitPrice.toLocaleString('id-ID'))}</td>
        <td style="text-align: right; padding: 0.3mm 0;">${isBundleItem ? '-' : (isNaN(baseSubtotal) ? '0' : baseSubtotal.toLocaleString('id-ID'))}</td>
      </tr>
      `;
      } catch (productError) {
        console.error(`❌ [HTML GEN] Error processing product:`, product, productError);
        return `<tr><td colspan="4">Error processing product: ${product?.product_name || 'Unknown'}</td></tr>`;
      }
    }).join('');

    const regularProducts = report.productSales.filter((p) => !p.is_bundle_item);
    const totalProductQty = report.productSales.reduce((sum, p) => sum + p.total_quantity, 0);
    const totalProductBaseSubtotal = regularProducts.reduce((sum, p) => sum + (p.base_subtotal ?? (p.total_subtotal - p.customization_subtotal)), 0);

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
        <td style="text-align: right; padding: 0.3mm 0;">${isNaN(quantity) ? '0' : quantity}</td>
        <td style="text-align: right; padding: 0.3mm 0;">${isNaN(revenue) ? '0' : revenue.toLocaleString('id-ID')}</td>
      </tr>
    `;
      } catch (customizationError) {
        console.error(`❌ [HTML GEN] Error processing customization:`, item, customizationError);
        return `<tr><td colspan="3">Error processing customization</td></tr>`;
      }
    }).join('');

    const totalCustomizationUnits = report.customizationSales.reduce((sum, item) => sum + item.total_quantity, 0);
    const totalCustomizationRevenue = report.customizationSales.reduce((sum, item) => sum + item.total_revenue, 0);

    const paymentRows = report.paymentBreakdown.map(payment => `
      <tr>
        <td style="text-align: left; padding: 0.3mm 0;">${payment.payment_method_name || 'N/A'}</td>
        <td style="text-align: right; padding: 0.3mm 0;">${payment.transaction_count}</td>
        <td style="text-align: right; padding: 0.3mm 0;">${(payment.total_amount || 0).toLocaleString('id-ID')}</td>
      </tr>
    `).join('');

    const totalPaymentCount = report.paymentBreakdown.reduce((sum: number, p) => sum + p.transaction_count, 0);
    const totalPaymentAmount = report.paymentBreakdown.reduce((sum: number, p) => sum + (p.total_amount || 0), 0);

    const category2Rows = (report.category2Breakdown || []).map((category2: { category2_name: string; total_quantity: number; total_amount: number }) => `
      <tr>
        <td style="text-align: left; padding: 0.3mm 0;">${category2.category2_name || 'N/A'}</td>
        <td style="text-align: right; padding: 0.3mm 0;">${category2.total_quantity || 0}</td>
        <td style="text-align: right; padding: 0.3mm 0;">${(category2.total_amount || 0).toLocaleString('id-ID')}</td>
      </tr>
    `).join('');

    const totalCategory2Quantity = (report.category2Breakdown || []).reduce((sum: number, c: { total_quantity: number }) => sum + (c.total_quantity || 0), 0);
    const totalCategory2Amount = (report.category2Breakdown || []).reduce((sum: number, c: { total_amount: number }) => sum + (c.total_amount || 0), 0);
    const formattedTotalDiscount = report.statistics.total_discount > 0
      ? formatCurrency(-Math.abs(report.statistics.total_discount))
      : formatCurrency(0);
    const cashSummaryData = report.cashSummary;
    const cashShiftSales = cashSummaryData.cash_shift_sales ?? cashSummaryData.cash_shift ?? 0;
    const cashShiftRefunds = cashSummaryData.cash_shift_refunds ?? 0;
    const cashWholeDaySales = cashSummaryData.cash_whole_day_sales ?? cashSummaryData.cash_whole_day ?? 0;
    const cashWholeDayRefunds = cashSummaryData.cash_whole_day_refunds ?? 0;
    const cashNetShift = cashSummaryData.cash_shift ?? (cashShiftSales - cashShiftRefunds);
    const cashNetWholeDay = cashSummaryData.cash_whole_day ?? (cashWholeDaySales - cashWholeDayRefunds);
    const kasMulaiSummary = cashSummaryData.kas_mulai ?? report.modal_awal ?? 0;
    const kasExpectedSummary = cashSummaryData.kas_expected ?? (kasMulaiSummary + cashShiftSales - cashShiftRefunds);
    const kasAkhirSummary = typeof cashSummaryData.kas_akhir === 'number' ? cashSummaryData.kas_akhir : null;
    let kasSelisihSummary =
      typeof cashSummaryData.kas_selisih === 'number'
        ? cashSummaryData.kas_selisih
        : kasAkhirSummary !== null
          ? Number((kasAkhirSummary - kasExpectedSummary).toFixed(2))
          : null;
    let kasSelisihLabelSummary: 'balanced' | 'plus' | 'minus' | null =
      cashSummaryData.kas_selisih_label ?? null;
    if (kasSelisihSummary !== null) {
      if (Math.abs(kasSelisihSummary) < 0.01) {
        kasSelisihSummary = 0;
        kasSelisihLabelSummary = 'balanced';
      } else if (!kasSelisihLabelSummary) {
        kasSelisihLabelSummary = kasSelisihSummary > 0 ? 'plus' : 'minus';
      }
    }
    const varianceLabelDisplay =
      kasSelisihLabelSummary === 'plus'
        ? 'Plus'
        : kasSelisihLabelSummary === 'minus'
          ? 'Minus'
          : kasSelisihLabelSummary === 'balanced'
            ? 'Balanced'
            : 'Pending';
    const varianceValueDisplay =
      kasSelisihSummary === null
        ? '-'
        : `${kasSelisihSummary > 0 ? '+' : ''}${kasSelisihSummary.toLocaleString('id-ID')}`;
    const kasAkhirDisplay = kasAkhirSummary !== null ? kasAkhirSummary.toLocaleString('id-ID') : '-';
    const totalCashInCashierDisplay = (cashSummaryData.total_cash_in_cashier ?? kasExpectedSummary).toLocaleString('id-ID');

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
        <span class="info-value">${report.modal_awal.toLocaleString('id-ID')}</span>
      </div>

      <div class="divider"></div>

      <div class="section-title">BARANG TERJUAL</div>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th class="right">Qty</th>
            <th class="right">Unit Price</th>
            <th class="right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${productRows || '<tr><td colSpan="4" style="text-align: center;">Tidak ada produk</td></tr>'}
          <tr class="total-row">
            <td>TOTAL</td>
            <td class="right">${totalProductQty}</td>
            <td class="right">-</td>
            <td class="right">${totalProductBaseSubtotal.toLocaleString('id-ID')}</td>
          </tr>
        </tbody>
      </table>

      <div class="divider"></div>

      <div class="section-title">PAYMENT METHOD</div>
      <table>
        <thead>
          <tr>
            <th>Payment Method</th>
            <th class="right">Count</th>
            <th class="right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${paymentRows || '<tr><td colSpan="3" style="text-align: center;">Tidak ada transaksi</td></tr>'}
          <tr class="total-row">
            <td>TOTAL</td>
            <td class="right">${totalPaymentCount}</td>
            <td class="right">${totalPaymentAmount.toLocaleString('id-ID')}</td>
          </tr>
        </tbody>
      </table>

      <div class="divider"></div>

      <div class="section-title">CATEGORY II</div>
      <table>
        <thead>
          <tr>
            <th>Category II</th>
            <th class="right">Quantity</th>
            <th class="right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${category2Rows || '<tr><td colSpan="3" style="text-align: center;">Tidak ada Category II</td></tr>'}
          <tr class="total-row">
            <td>TOTAL</td>
            <td class="right">${totalCategory2Quantity}</td>
            <td class="right">${totalCategory2Amount.toLocaleString('id-ID')}</td>
          </tr>
        </tbody>
      </table>

      <div class="divider"></div>

      <div class="section-title">TOPPING SALES BREAKDOWN</div>
      <table>
        <thead>
          <tr>
            <th>Customization</th>
            <th class="right">Qty</th>
            <th class="right">Revenue</th>
          </tr>
        </thead>
        <tbody>
          ${customizationRows || '<tr><td colSpan="3" style="text-align: center;">Tidak ada kustomisasi</td></tr>'}
          <tr class="total-row">
            <td>TOTAL</td>
            <td class="right">${totalCustomizationUnits}</td>
            <td class="right">${totalCustomizationRevenue.toLocaleString('id-ID')}</td>
          </tr>
        </tbody>
      </table>

      <div class="divider"></div>

      <div class="section-title">DISKON & VOUCHER</div>
      <table>
        <tbody>
          <tr>
            <td style="text-align: left; padding: 0.3mm 0;">Voucher Digunakan</td>
            <td class="right">${report.statistics.voucher_count}</td>
          </tr>
          <tr>
            <td style="text-align: left; padding: 0.3mm 0;">Total Diskon Voucher</td>
            <td class="right">${formattedTotalDiscount}</td>
          </tr>
        </tbody>
      </table>

      <div class="divider"></div>

      <div class="summary">
        <div class="summary-line">
          <span class="summary-label">Total Pesanan:</span>
          <span class="summary-value">${report.statistics.order_count}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Total Transaksi:</span>
          <span class="summary-value">${report.statistics.total_amount.toLocaleString('id-ID')}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Topping Units:</span>
          <span class="summary-value">${totalCustomizationUnits}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Total Topping:</span>
          <span class="summary-value">${totalCustomizationRevenue.toLocaleString('id-ID')}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Voucher Dipakai:</span>
          <span class="summary-value">${report.statistics.voucher_count}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Total Diskon Voucher:</span>
          <span class="summary-value">${formattedTotalDiscount}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Kas Mulai:</span>
          <span class="summary-value">${kasMulaiSummary.toLocaleString('id-ID')}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Cash Sales (Shift):</span>
          <span class="summary-value">${cashShiftSales.toLocaleString('id-ID')}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Cash Refunds (Shift):</span>
          <span class="summary-value">-${cashShiftRefunds.toLocaleString('id-ID')}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Net Cash (Shift):</span>
          <span class="summary-value">${cashNetShift.toLocaleString('id-ID')}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Kas Diharapkan:</span>
          <span class="summary-value">${kasExpectedSummary.toLocaleString('id-ID')}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Kas Akhir:</span>
          <span class="summary-value">${kasAkhirDisplay}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Selisih (${varianceLabelDisplay}):</span>
          <span class="summary-value">${varianceValueDisplay}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Cash Sales (Hari):</span>
          <span class="summary-value">${cashWholeDaySales.toLocaleString('id-ID')}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Cash Refunds (Hari):</span>
          <span class="summary-value">-${cashWholeDayRefunds.toLocaleString('id-ID')}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Net Cash (Hari):</span>
          <span class="summary-value">${cashNetWholeDay.toLocaleString('id-ID')}</span>
        </div>
        <div class="summary-line">
          <span class="summary-label">Cash in Cashier:</span>
          <span class="summary-value">${totalCashInCashierDisplay}</span>
        </div>
      </div>
    </div>
    `;
  };

  const sections: string[] = [];
  sections.push(
    renderReportSection(shiftData, {
      titleOverride: shiftData.title || 'LAPORAN SHIFT',
      businessName: shiftData.businessName
    })
  );
  if (shiftData.wholeDayReport) {
    sections.push(
      renderReportSection(shiftData.wholeDayReport, {
        titleOverride: shiftData.wholeDayReport.title || 'RINGKASAN HARIAN',
        businessName: shiftData.businessName
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

type PrintableShiftReportSection = {
  title?: string;
  user_name: string;
  shift_start: string;
  shift_end: string | null;
  modal_awal: number;
  statistics: { order_count: number; total_amount: number; total_discount: number; voucher_count: number };
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
  customizationSales: Array<{
    option_id: number;
    option_name: string;
    customization_id: number;
    customization_name: string;
    total_quantity: number;
    total_revenue: number;
  }>;
  paymentBreakdown: Array<{ payment_method_name: string; transaction_count: number; total_amount: number }>;
  category2Breakdown?: Array<{ category2_name: string; category2_id: number; total_quantity: number; total_amount: number }>;
  cashSummary: PrintableCashSummary;
};

// Print shift breakdown report
ipcMain.handle('print-shift-breakdown', async (event, data: PrintableShiftReportSection & { business_id?: number; printerType?: string; wholeDayReport?: PrintableShiftReportSection | null }) => {
  try {
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
    if (localDb) {
      try {
        // First, list ALL printer configs for debugging
        const allConfigs = localDb.prepare('SELECT * FROM printer_configs').all() as PrinterConfigRow[];
        console.log('📋 [SHIFT PRINT] All printer configs in database:');
        allConfigs.forEach((cfg: PrinterConfigRow) => {
          console.log(`   - Type: ${cfg.printer_type}, Name: "${cfg.system_printer_name}"`);
        });
        
        const config = localDb.prepare('SELECT * FROM printer_configs WHERE printer_type = ?').get(printerType) as PrinterConfigRow | undefined;
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
    } else {
      console.error('❌ [SHIFT PRINT] Local database not available');
      return { success: false, error: 'Database not available' };
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
    if (data.business_id && localDb) {
      try {
        const business = localDb.prepare('SELECT name FROM businesses WHERE id = ?').get(data.business_id) as { name: string } | undefined;
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
      htmlContent = generateShiftBreakdownHTML({
        ...data,
        productSales: data.productSales || [],
        customizationSales: data.customizationSales || [],
        paymentBreakdown: data.paymentBreakdown || [],
        category2Breakdown: data.category2Breakdown || [],
        cashSummary: data.cashSummary,
        wholeDayReport: data.wholeDayReport || null,
        businessName
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

    const printOptions = {
      silent: true,
      printBackground: false,
      deviceName: printerName,
    };
    
    console.log('🖨️ [SHIFT PRINT] Print options:', JSON.stringify(printOptions, null, 2));
    console.log('   - deviceName type:', typeof printerName);
    console.log('   - deviceName length:', printerName?.length || 0);
    console.log('   - deviceName value:', `"${printerName}"`);

    // Use callback-based print to properly wait for completion and catch errors
    return new Promise((resolve) => {
      const currentWindow = printWindow;
      setTimeout(() => {
        try {
          if (!currentWindow || currentWindow.isDestroyed()) {
            console.error('❌ [SHIFT PRINT] Print window not available');
            resolve({ success: false, error: 'Print window unavailable' });
            return;
          }

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
    title: 'Marviano POS - Customer Display',
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

// ============================================================================
// SLIDESHOW IMAGE MANAGEMENT (userData storage)
// ============================================================================

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
  if (!localDb) {
    return {
      success: false,
      error: 'Local database not available',
      stats: {}
    };
  }

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

    // Step 2: Restore Master Data (order matters due to foreign keys!)
    console.log('💾 [RESTORE] Step 2: Restoring master data...');

    // 2.1 Businesses
    if (Array.isArray(data.businesses) && data.businesses.length > 0) {
      const stmt = localDb.prepare(`
        INSERT OR REPLACE INTO businesses (id, name, permission_name, organization_id, management_group_id, image_url, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const biz of data.businesses) {
        stmt.run(
          biz.id,
          biz.name,
          biz.permission_name || biz.name || 'business',
          biz.organization_id || null,
          biz.management_group_id || null,
          biz.image_url || null,
          biz.created_at || new Date().toISOString(),
          Date.now()
        );
      }
      stats.businesses = data.businesses.length;
      console.log(`✅ [RESTORE] ${data.businesses.length} businesses restored`);
    }

    // 2.2 Users
    if (Array.isArray(data.users) && data.users.length > 0) {
      const stmt = localDb.prepare(`
        INSERT OR REPLACE INTO users (id, email, password, name, googleId, createdAt, role_id, organization_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const usr of data.users) {
        stmt.run(
          usr.id,
          usr.email,
          usr.password || null,
          usr.name,
          usr.googleId || null,
          usr.created_at || usr.createdAt || new Date().toISOString(),
          usr.role_id || null,
          usr.organization_id || null,
          Date.now()
        );
      }
      stats.users = data.users.length;
      console.log(`✅ [RESTORE] ${data.users.length} users restored`);
    }

    // 2.3 Categories
    if (Array.isArray(data.category1) && data.category1.length > 0) {
      const stmt = localDb.prepare(`
        INSERT OR REPLACE INTO category1 (id, name, description, display_order, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const cat of data.category1) {
        stmt.run(
          cat.id,
          cat.name,
          cat.description || null,
          cat.display_order || 0,
          cat.is_active !== undefined ? cat.is_active : 1,
          cat.created_at || new Date().toISOString(),
          Date.now()
        );
      }
      stats.category1 = data.category1.length;
      console.log(`✅ [RESTORE] ${data.category1.length} category1 restored`);
    }

    if (Array.isArray(data.category2) && data.category2.length > 0) {
      const stmt = localDb.prepare(`
        INSERT OR REPLACE INTO category2 (id, name, business_id, description, display_order, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const cat of data.category2) {
        stmt.run(
          cat.id,
          cat.name,
          cat.business_id || businessId,
          cat.description || null,
          cat.display_order || 0,
          cat.is_active !== undefined ? cat.is_active : 1,
          cat.created_at || new Date().toISOString(),
          Date.now()
        );
      }
      stats.category2 = data.category2.length;
      console.log(`✅ [RESTORE] ${data.category2.length} category2 restored`);
    }

    // 2.4 Products (matching local schema: nama, harga_jual, kategori, etc.)
    if (Array.isArray(data.products) && data.products.length > 0) {
      const stmt = localDb.prepare(`
        INSERT OR REPLACE INTO products (
          id, business_id, menu_code, nama, satuan, kategori, jenis, 
          category2_id, category2_name, keterangan, harga_beli, ppn, 
          harga_jual, harga_khusus, harga_online, harga_qpon, harga_gofood, 
          harga_grabfood, harga_shopeefood, harga_tiktok, fee_kerja, 
          status, created_at, updated_at, has_customization, is_bundle
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const prod of data.products) {
        stmt.run(
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
          prod.created_at || new Date().toISOString(),
          Date.now(),
          prod.has_customization || 0,
          prod.is_bundle || 0
        );
      }
      stats.products = data.products.length;
      console.log(`✅ [RESTORE] ${data.products.length} products restored`);
    }

    // 2.5 Customization Types
    if (Array.isArray(data.customizationTypes) && data.customizationTypes.length > 0) {
      const stmt = localDb.prepare(`
        INSERT OR REPLACE INTO product_customization_types (id, name, selection_mode)
        VALUES (?, ?, ?)
      `);
      for (const type of data.customizationTypes) {
        stmt.run(
          type.id,
          type.name,
          type.selection_mode || 'single'
        );
      }
      stats.customizationTypes = data.customizationTypes.length;
      console.log(`✅ [RESTORE] ${data.customizationTypes.length} customization types restored`);
    }

    // 2.6 Customization Options
    if (Array.isArray(data.customizationOptions) && data.customizationOptions.length > 0) {
      const stmt = localDb.prepare(`
        INSERT OR REPLACE INTO product_customization_options (id, type_id, name, price_adjustment, display_order)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const opt of data.customizationOptions) {
        stmt.run(
          opt.id,
          opt.type_id,
          opt.name,
          opt.price_adjustment || 0,
          opt.display_order || 0
        );
      }
      stats.customizationOptions = data.customizationOptions.length;
      console.log(`✅ [RESTORE] ${data.customizationOptions.length} customization options restored`);
    }

    // 2.7 Product Customizations
    if (Array.isArray(data.productCustomizations) && data.productCustomizations.length > 0) {
      const stmt = localDb.prepare(`
        INSERT OR REPLACE INTO product_customizations (id, product_id, customization_type_id)
        VALUES (?, ?, ?)
      `);
      for (const pc of data.productCustomizations) {
        stmt.run(
          pc.id,
          pc.product_id,
          pc.customization_type_id
        );
      }
      stats.productCustomizations = data.productCustomizations.length;
      console.log(`✅ [RESTORE] ${data.productCustomizations.length} product customizations restored`);
    }

    // 2.8 Bundle Items
    if (Array.isArray(data.bundleItems) && data.bundleItems.length > 0) {
      const stmt = localDb.prepare(`
        INSERT OR REPLACE INTO bundle_items (id, bundle_product_id, category2_id, required_quantity, display_order)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const bundle of data.bundleItems) {
        stmt.run(
          bundle.id,
          bundle.bundle_product_id,
          bundle.category2_id,
          bundle.required_quantity || 1,
          bundle.display_order || 0
        );
      }
      stats.bundleItems = data.bundleItems.length;
      console.log(`✅ [RESTORE] ${data.bundleItems.length} bundle items restored`);
    }

    // 2.9 Payment Methods
    if (Array.isArray(data.paymentMethods) && data.paymentMethods.length > 0) {
      const stmt = localDb.prepare(`
        INSERT OR REPLACE INTO payment_methods (id, name, code, description, is_active, requires_additional_info, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const pm of data.paymentMethods) {
        stmt.run(
          pm.id,
          pm.name,
          pm.code,
          pm.description || null,
          pm.is_active !== undefined ? pm.is_active : 1,
          pm.requires_additional_info || 0,
          pm.created_at || new Date().toISOString(),
          Date.now()
        );
      }
      stats.paymentMethods = data.paymentMethods.length;
      console.log(`✅ [RESTORE] ${data.paymentMethods.length} payment methods restored`);
    }

    // 2.10 Banks
    if (Array.isArray(data.banks) && data.banks.length > 0) {
      const stmt = localDb.prepare(`
        INSERT OR REPLACE INTO banks (id, bank_code, bank_name, is_popular, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const bank of data.banks) {
        stmt.run(
          bank.id,
          bank.bank_code,
          bank.bank_name,
          bank.is_popular || 0,
          bank.is_active !== undefined ? bank.is_active : 1,
          bank.created_at || new Date().toISOString()
        );
      }
      stats.banks = data.banks.length;
      console.log(`✅ [RESTORE] ${data.banks.length} banks restored`);
    }

    // 2.11 CL Accounts
    if (Array.isArray(data.clAccounts) && data.clAccounts.length > 0) {
      const stmt = localDb.prepare(`
        INSERT OR REPLACE INTO cl_accounts (id, account_code, account_name, contact_info, credit_limit, current_balance, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const cl of data.clAccounts) {
        stmt.run(
          cl.id,
          cl.account_code,
          cl.account_name,
          cl.contact_info || null,
          cl.credit_limit || 0,
          cl.current_balance || 0,
          cl.is_active !== undefined ? cl.is_active : 1,
          cl.created_at || new Date().toISOString(),
          Date.now()
        );
      }
      stats.clAccounts = data.clAccounts.length;
      console.log(`✅ [RESTORE] ${data.clAccounts.length} CL accounts restored`);
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
          const txStmt = localDb.prepare(`
            INSERT OR REPLACE INTO transactions (
              id, business_id, user_id, payment_method, payment_method_id,
              pickup_method, total_amount, final_amount, amount_received, change_amount,
              customer_name, status, created_at, updated_at, voucher_discount,
              voucher_type, voucher_value, transaction_type, receipt_number, shift_uuid
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          for (const tx of transactions) {
            const txId = tx.uuid_id || tx.id;
            txStmt.run(
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
              tx.created_at || new Date().toISOString(),
              Date.now(),
              tx.voucher_discount || 0,
              tx.voucher_type || null,
              tx.voucher_value || null,
              tx.transaction_type || 'drinks',
              tx.receipt_number || null,
              tx.shift_uuid || null
            );
          }

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
          const itemStmt = localDb.prepare(`
            INSERT OR REPLACE INTO transaction_items (
              id, transaction_id, product_id, quantity, unit_price, total_price,
              custom_note, bundle_selections_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

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
            
            itemStmt.run(
              itemId,
              transactionId,
              item.product_id,
              item.quantity || 1,
              item.unit_price || 0,
              item.total_price || 0,
              item.custom_note || null,
              bundleSelectionsStr,
              item.created_at || new Date().toISOString()
            );
          }

            stats.transactionItems = items.length;
            console.log(`✅ [RESTORE] ${items.length} transaction items restored`);
          } else {
            console.warn('⚠️ [RESTORE] No transaction items found in response');
          }
        }
      } catch (itemsError) {
        console.error('❌ [RESTORE] Error downloading transaction items:', itemsError);
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

