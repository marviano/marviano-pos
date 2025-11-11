import { app, BrowserWindow, Menu, ipcMain, screen } from 'electron';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { PrinterManagementService } from './printerManagement';

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
  return path.join(__dirname, '../pos-offline.db');
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
      const schemaCheck = localDb.prepare(`PRAGMA table_info(transactions)`).all() as any[];
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
    } catch (e) {
      console.log('⚠️ Migration check failed:', e);
    }

      // Schema migration: Ensure platform price columns exist on products
      try {
        const productSchema = localDb.prepare(`PRAGMA table_info(products)`).all() as any[];
        const hasHargaGofood = productSchema.some(col => col.name === 'harga_gofood');
        const hasHargaGrabfood = productSchema.some(col => col.name === 'harga_grabfood');
        const hasHargaShopeefood = productSchema.some(col => col.name === 'harga_shopeefood');
        const hasHargaTiktok = productSchema.some(col => col.name === 'harga_tiktok');
        const hasHargaQpon = productSchema.some(col => col.name === 'harga_qpon');
        const hasCategory2Name = productSchema.some(col => col.name === 'category2_name');
        const hasIsBundle = productSchema.some(col => col.name === 'is_bundle');

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

        // Check if transaction_items has bundle_selections_json column
        const transactionItemsSchema = localDb.prepare(`PRAGMA table_info(transaction_items)`).all() as any[];
        const hasBundleSelections = transactionItemsSchema.some(col => col.name === 'bundle_selections_json');
        
        if (!hasBundleSelections) {
          console.log('📋 Migrating database: Adding transaction_items.bundle_selections_json column...');
          localDb.prepare('ALTER TABLE transaction_items ADD COLUMN bundle_selections_json TEXT').run();
        }
      } catch (e) {
        console.log('⚠️ Bundle feature migration check failed:', e);
      }
    
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
        customizations_json TEXT,
        custom_note TEXT,
        bundle_selections_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
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
      
      CREATE TABLE IF NOT EXISTS omset (
        id INTEGER PRIMARY KEY,
        business_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        regular INTEGER,
        ojol INTEGER,
        event INTEGER,
        delivery INTEGER,
        fitness INTEGER,
        pool INTEGER,
        user_id INTEGER NOT NULL,
        created_at TEXT,
        updated_at INTEGER,
        UNIQUE(business_id, date),
        FOREIGN KEY (business_id) REFERENCES businesses(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
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
      
      CREATE INDEX IF NOT EXISTS idx_omset_business_date ON omset(business_id, date);
      CREATE INDEX IF NOT EXISTS idx_omset_date ON omset(date);
      
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
      const printerConfigSchema = localDb.prepare(`PRAGMA table_info(printer_configs)`).all() as any[];
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
    const customerWindowWidth = Math.floor(secondaryDisplay.workAreaSize.width * 0.9);
    const customerWindowHeight = Math.floor(secondaryDisplay.workAreaSize.height * 0.9);
    
    console.log('🔍 Customer window dimensions:', { width: customerWindowWidth, height: customerWindowHeight });
    console.log('🔍 Customer window position:', { x: secondaryDisplay.workArea.x, y: secondaryDisplay.workArea.y });
    
    customerWindow = new BrowserWindow({
      width: customerWindowWidth,
      height: customerWindowHeight,
      x: secondaryDisplay.workArea.x,
      y: secondaryDisplay.workArea.y,
      title: 'Marviano POS - Customer Display',
      frame: false,
      backgroundColor: '#000000',
      alwaysOnTop: true,
      kiosk: false, // Temporarily disable kiosk mode for debugging
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
        // Try ports in order: 3000, 3001, 3002 (3000 is default Next.js port)
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
      }, 6000); // Load after main window
    } else {
      customerWindow.loadFile(path.join(__dirname, '../out/customer-display.html'));
    }
  } else {
    console.log('❌ Cannot create customer display - no secondary monitor detected');
  }

  // Listen for navigation events
  mainWindow.webContents.on('did-navigate', (event, url) => {
    const currentURL = new URL(url);
    console.log('🔍 Navigation detected:', currentURL.pathname);
    
    if (currentURL.pathname === '/login') {
      // Keep login page at 800x432
      console.log('🔍 Login page detected - setting login window size');
      mainWindow!.setFullScreen(false);
      mainWindow!.setResizable(false);
      mainWindow!.setSize(800, 432);
      mainWindow!.center();
    } else if (currentURL.pathname === '/' || !currentURL.pathname.includes('/login')) {
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
    
    if (currentURL.pathname === '/login') {
      // Keep login page at 800x432
      console.log('🔍 Login page detected - setting login window size');
      mainWindow!.setFullScreen(false);
      mainWindow!.setResizable(false);
      mainWindow!.setSize(800, 432);
      mainWindow!.center();
    } else if (currentURL.pathname === '/' || !currentURL.pathname.includes('/login')) {
      // Main POS page - set to fullscreen
      console.log('🔍 Main POS page detected - setting fullscreen');
      mainWindow!.setResizable(true);
      mainWindow!.setFullScreen(true);
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
  ipcMain.handle('localdb-upsert-products', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
      const stmt = localDb!.prepare(`INSERT INTO products (
        id, business_id, menu_code, nama, satuan, kategori, jenis, category2_name, keterangan,
        harga_beli, ppn, harga_jual, harga_khusus, harga_online, harga_qpon, harga_gofood, harga_grabfood, harga_shopeefood, harga_tiktok, fee_kerja, status, is_bundle, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        business_id=excluded.business_id,
        menu_code=excluded.menu_code,
        nama=excluded.nama,
        satuan=excluded.satuan,
        kategori=excluded.kategori,
        jenis=excluded.jenis,
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
      for (const r of data) {
        // Map MySQL columns to SQLite columns
        const kategori = r.kategori || r.category1_name || '';
        const category2Name = r.category2_name || r.jenis || '';
        const isBundle = r.is_bundle === 1 || r.is_bundle === true ? 1 : 0;
        
        stmt.run(
          r.id, r.business_id, r.menu_code, r.nama, r.satuan || '', kategori, null, category2Name, r.keterangan || null,
          r.harga_beli || null, r.ppn || null, r.harga_jual, r.harga_khusus || null, 
          r.harga_online || null, r.harga_qpon || null, r.harga_gofood || null, r.harga_grabfood || null, r.harga_shopeefood || null, r.harga_tiktok || null,
          r.fee_kerja || null, r.status, isBundle, Date.now()
        );
      }
    });
    tx(rows);
    return { success: true };
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
  ipcMain.handle('localdb-upsert-customization-types', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
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
  
  ipcMain.handle('localdb-upsert-customization-options', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
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
  
  ipcMain.handle('localdb-upsert-product-customizations', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
      const stmt = localDb!.prepare(`INSERT INTO product_customizations (
        id, product_id, customization_type_id, updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        product_id=excluded.product_id, customization_type_id=excluded.customization_type_id,
        updated_at=excluded.updated_at`);
      for (const r of data) {
        stmt.run(r.id, r.product_id, r.customization_type_id, Date.now());
      }
    });
    tx(rows);
    return { success: true };
  });
  
  // Bundle items handlers
  ipcMain.handle('localdb-get-bundle-items', async (event, productId: number) => {
    if (!localDb) return [];
    try {
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
      `).all(productId) as any[];
      
      return bundleItems.map(item => ({
        id: item.id,
        bundle_product_id: item.bundle_product_id,
        category2_id: item.category2_id,
        category2_name: item.category2_name,
        required_quantity: item.required_quantity,
        display_order: item.display_order
      }));
    } catch (error: any) {
      console.error('Error fetching bundle items:', error);
      return [];
    }
  });

  ipcMain.handle('localdb-upsert-bundle-items', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
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
      for (const r of data) {
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
      }
    });
    tx(rows);
    return { success: true };
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
      const types = typesStmt.all(productId) as any[];
      console.log(`📋 [OFFLINE] Found ${types.length} customization types for product ${productId}`, types);
      
      // For each type, get all available options (not just for this product)
      const customizations = types.map((type: any) => {
        const optionsStmt = localDb!.prepare(`
          SELECT co.id, co.type_id, co.name, co.price_adjustment, co.display_order
          FROM product_customization_options co
          WHERE co.type_id = ? AND co.status = 'active'
          ORDER BY co.display_order ASC, co.name ASC
        `);
        const options = optionsStmt.all(type.id) as any[];
        console.log(`📋 [OFFLINE] Type "${type.name}": found ${options.length} options`, options);
        
        return {
          id: type.id,
          name: type.name,
          selection_mode: type.selection_mode,
          options: options.map((option: any) => ({
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
  ipcMain.handle('localdb-upsert-users', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
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
  ipcMain.handle('localdb-upsert-businesses', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
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
  ipcMain.handle('localdb-upsert-ingredients', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
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
  ipcMain.handle('localdb-upsert-cogs', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
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
  ipcMain.handle('localdb-upsert-contacts', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
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
  ipcMain.handle('localdb-upsert-teams', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
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
  ipcMain.handle('localdb-upsert-roles', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
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
  ipcMain.handle('localdb-upsert-permissions', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
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
  ipcMain.handle('localdb-upsert-role-permissions', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
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
  ipcMain.handle('localdb-get-user-auth', async (event, email: string) => {
    if (!localDb) return null;
    const userStmt = localDb.prepare(`
      SELECT id, email, password, name, role_id, organization_id
      FROM users
      WHERE LOWER(email) = LOWER(?)
      LIMIT 1
    `);
    const user = userStmt.get(email);

    if (!user) {
      return null;
    }

    let roleName: string | null = null;
    if (user.role_id !== null && user.role_id !== undefined) {
      const roleStmt = localDb.prepare('SELECT name FROM roles WHERE id = ? LIMIT 1');
      const role = roleStmt.get(user.role_id);
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
      ? permissionsStmt.all(user.role_id)
      : [];

    return {
      ...user,
      role_name: roleName,
      permissions: Array.isArray(permissionRows) ? permissionRows.map((row: any) => row.name) : [],
    };
  });

  // Supporting tables
  ipcMain.handle('localdb-upsert-source', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
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

  ipcMain.handle('localdb-upsert-pekerjaan', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
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
  ipcMain.handle('localdb-upsert-transactions', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
      const stmt = localDb!.prepare(`INSERT INTO transactions (
        id, business_id, user_id, payment_method, pickup_method, total_amount,
        voucher_discount, voucher_type, voucher_value, voucher_label, final_amount, amount_received, change_amount, status,
        created_at, updated_at, synced_at, contact_id, customer_name, customer_unit, note, bank_name,
        card_number, cl_account_id, cl_account_name, bank_id, receipt_number,
        transaction_type, payment_method_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        business_id=excluded.business_id, user_id=excluded.user_id, payment_method=excluded.payment_method,
        pickup_method=excluded.pickup_method, total_amount=excluded.total_amount, voucher_discount=excluded.voucher_discount,
        voucher_type=excluded.voucher_type, voucher_value=excluded.voucher_value, voucher_label=excluded.voucher_label,
        final_amount=excluded.final_amount, amount_received=excluded.amount_received, change_amount=excluded.change_amount,
        status=excluded.status, created_at=excluded.created_at, updated_at=excluded.updated_at, synced_at=excluded.synced_at,
        contact_id=excluded.contact_id, customer_name=excluded.customer_name, customer_unit=excluded.customer_unit, note=excluded.note,
        bank_name=excluded.bank_name, card_number=excluded.card_number, cl_account_id=excluded.cl_account_id,
        cl_account_name=excluded.cl_account_name, bank_id=excluded.bank_id, receipt_number=excluded.receipt_number,
        transaction_type=excluded.transaction_type, payment_method_id=excluded.payment_method_id`);
      for (const r of data) {
        console.log('🔍 [SQLITE] Inserting transaction data:', {
          id: r.id,
          business_id: r.business_id,
          user_id: r.user_id,
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
        } catch (err: any) {
          console.error('❌ [SQLITE] Insert error:', err);
          console.error('📝 [SQLITE] Error code:', err.code);
          console.error('📝 [SQLITE] Error message:', err.message);
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
    const params: any[] = [];
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
    const params: any[] = [businessId];

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
    const params: any[] = [];
    
    if (businessId) {
      query += ' AND t.business_id = ?';
      params.push(businessId);
    }
    
    query += ' ORDER BY t.created_at DESC';
    
    const stmt = localDb.prepare(query);
    return stmt.all(...params);
  });

  // Transaction Items
  ipcMain.handle('localdb-upsert-transaction-items', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    console.log('🔍 [SQLITE] Inserting transaction items:', rows.length);
    const tx = localDb.transaction((data: any[]) => {
      const stmt = localDb!.prepare(`INSERT INTO transaction_items (
        id, transaction_id, product_id, quantity, unit_price, total_price,
        customizations_json, bundle_selections_json, custom_note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        transaction_id=excluded.transaction_id, product_id=excluded.product_id, quantity=excluded.quantity,
        unit_price=excluded.unit_price, total_price=excluded.total_price, customizations_json=excluded.customizations_json,
        bundle_selections_json=excluded.bundle_selections_json,
        custom_note=excluded.custom_note, created_at=excluded.created_at`);
      for (const r of data) {
        console.log('📦 [SQLITE] Item data:', {
          id: r.id,
          transaction_id: r.transaction_id,
          product_id: r.product_id,
          customizations_json: r.customizations_json,
          customizations_type: typeof r.customizations_json,
          custom_note: r.custom_note
        });
        
        // Parse customizations_json if it's already a string, otherwise stringify if it's an object
        let customizationsJson = null;
        if (r.customizations_json) {
          customizationsJson = typeof r.customizations_json === 'string' 
            ? r.customizations_json 
            : JSON.stringify(r.customizations_json);
        }
        let bundleSelectionsJson = null;
        if (r.bundle_selections_json) {
          bundleSelectionsJson = typeof r.bundle_selections_json === 'string'
            ? r.bundle_selections_json
            : JSON.stringify(r.bundle_selections_json);
        }
        
        console.log('📦 [SQLITE] Final customizations JSON:', customizationsJson);
        console.log('📝 [SQLITE] Custom note:', r.custom_note);
        
        stmt.run(r.id, r.transaction_id, r.product_id, r.quantity || 1, r.unit_price, r.total_price,
                customizationsJson, bundleSelectionsJson, r.custom_note, r.created_at);
      }
    });
    tx(rows);
    console.log('✅ [SQLITE] Transaction items inserted');
    return { success: true };
  });

  ipcMain.handle('localdb-get-transaction-items', async (event, transactionId?: number) => {
    if (!localDb) return [];
    if (transactionId) {
      const stmt = localDb.prepare('SELECT * FROM transaction_items WHERE transaction_id = ? ORDER BY id ASC');
      return stmt.all(transactionId);
    } else {
      const stmt = localDb.prepare('SELECT * FROM transaction_items ORDER BY created_at DESC');
      return stmt.all();
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
  
  // Get active shift for a user
  ipcMain.handle('localdb-get-active-shift', async (event, userId: number, businessId: number = 14) => {
    if (!localDb) return null;
    try {
      const stmt = localDb.prepare(`
        SELECT * FROM shifts 
        WHERE user_id = ? AND business_id = ? AND status = 'active' 
        ORDER BY shift_start DESC 
        LIMIT 1
      `);
      const shift = stmt.get(userId, businessId) as any;
      return shift || null;
    } catch (error) {
      console.error('Error getting active shift:', error);
      return null;
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
      return { success: false, error: String(error) };
    }
  });

  // End a shift
  ipcMain.handle('localdb-end-shift', async (event, shiftId: number) => {
    if (!localDb) return { success: false, error: 'Database not available' };
    try {
      const now = new Date().toISOString();
      const stmt = localDb.prepare(`
        UPDATE shifts 
        SET shift_end = ?, status = 'completed', updated_at = ?
        WHERE id = ? AND status = 'active'
      `);
      
      const result = stmt.run(now, Date.now(), shiftId);
      
      if (result.changes === 0) {
        return { success: false, error: 'Shift not found or already ended' };
      }
      
      console.log(`✅ [SHIFTS] Ended shift ${shiftId}`);
      return { success: true };
    } catch (error) {
      console.error('Error ending shift:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get shift statistics
  ipcMain.handle('localdb-get-shift-statistics', async (event, userId: number, shiftStart: string, shiftEnd: string | null, businessId: number = 14) => {
    if (!localDb) return {
      order_count: 0,
      total_amount: 0
    };
    
    try {
      // Order count query
      let orderCountQuery = `
        SELECT COUNT(*) as order_count
        FROM transactions
        WHERE user_id = ? AND business_id = ? 
        AND datetime(created_at) >= datetime(?)
        AND status = 'completed'
      `;
      const orderParams: any[] = [userId, businessId, shiftStart];
      
      if (shiftEnd) {
        orderCountQuery += ' AND datetime(created_at) <= datetime(?)';
        orderParams.push(shiftEnd);
      }
      
      const orderStmt = localDb.prepare(orderCountQuery);
      const orderResult = orderStmt.get(...orderParams) as { order_count: number };
      
      // Total amount query
      let totalQuery = `
        SELECT COALESCE(SUM(final_amount), 0) as total_amount
        FROM transactions
        WHERE user_id = ? AND business_id = ?
        AND datetime(created_at) >= datetime(?)
        AND status = 'completed'
      `;
      const totalParams: any[] = [userId, businessId, shiftStart];
      
      if (shiftEnd) {
        totalQuery += ' AND datetime(created_at) <= datetime(?)';
        totalParams.push(shiftEnd);
      }
      
      const totalStmt = localDb.prepare(totalQuery);
      const totalResult = totalStmt.get(...totalParams) as { total_amount: number };
      
      return {
        order_count: orderResult.order_count || 0,
        total_amount: totalResult.total_amount || 0
      };
    } catch (error) {
      console.error('Error getting shift statistics:', error);
      return {
        order_count: 0,
        total_amount: 0
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
          COUNT(t.id) as transaction_count
        FROM transactions t
        LEFT JOIN payment_methods pm ON t.payment_method_id = pm.id
        WHERE t.user_id = ? AND t.business_id = ?
        AND datetime(t.created_at) >= datetime(?)
        AND t.status = 'completed'
      `;
      const params: any[] = [userId, businessId, shiftStart];
      
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
      const shiftParams: any[] = [userId, businessId, shiftStart, cashMethod.id];
      
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
      
      return {
        cash_shift: shiftResult.cash_total || 0,
        cash_whole_day: wholeDayResult.cash_total || 0
      };
    } catch (error) {
      console.error('Error getting cash summary:', error);
      return {
        cash_shift: 0,
        cash_whole_day: 0
      };
    }
  });

  // Get unsynced shifts
  ipcMain.handle('localdb-get-unsynced-shifts', async (event, businessId?: number) => {
    if (!localDb) return [];
    try {
      let query = 'SELECT * FROM shifts WHERE synced_at IS NULL';
      const params: any[] = [];
      
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
      const checkStmt = localDb.prepare(`
        SELECT COUNT(*) as count, MIN(created_at) as earliest_time
        FROM transactions
        WHERE user_id = ? 
        AND business_id = ?
        AND datetime(created_at) >= datetime(?)
        AND datetime(created_at) < datetime(?)
        AND status = 'completed'
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
      const stmt = localDb.prepare(`
        UPDATE shifts 
        SET shift_start = ?, updated_at = ?
        WHERE id = ? AND status = 'active'
      `);
      
      const result = stmt.run(newStartTime, Date.now(), shiftId);
      
      if (result.changes === 0) {
        return { success: false, error: 'Shift not found or not active' };
      }
      
      console.log(`✅ [SHIFTS] Updated shift ${shiftId} start time to ${newStartTime}`);
      return { success: true };
    } catch (error) {
      console.error('Error updating shift start time:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get product sales breakdown for shift
  ipcMain.handle('localdb-get-product-sales', async (event, userId: number, shiftStart: string, shiftEnd: string | null, businessId: number = 14) => {
    if (!localDb) return [];
    
    try {
      let query = `
        SELECT 
          p.id as product_id,
          p.nama as product_name,
          p.menu_code as product_code,
          SUM(ti.quantity) as total_quantity,
          SUM(ti.total_price) as total_subtotal
        FROM transaction_items ti
        INNER JOIN transactions t ON ti.transaction_id = t.id
        INNER JOIN products p ON ti.product_id = p.id
        WHERE t.user_id = ?
        AND t.business_id = ?
        AND datetime(t.created_at) >= datetime(?)
        AND t.status = 'completed'
      `;
      const params: any[] = [userId, businessId, shiftStart];
      
      if (shiftEnd) {
        query += ' AND datetime(t.created_at) <= datetime(?)';
        params.push(shiftEnd);
      }
      
      query += ' GROUP BY p.id, p.nama, p.menu_code ORDER BY total_subtotal DESC';
      
      const stmt = localDb.prepare(query);
      return stmt.all(...params);
    } catch (error) {
      console.error('Error getting product sales:', error);
      return [];
    }
  });
  
  // Payment Methods
  ipcMain.handle('localdb-upsert-payment-methods', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
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
  ipcMain.handle('localdb-upsert-banks', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
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
  ipcMain.handle('localdb-upsert-organizations', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
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
  ipcMain.handle('localdb-upsert-management-groups', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
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
  ipcMain.handle('localdb-upsert-category1', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
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
  ipcMain.handle('localdb-upsert-category2', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
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
  ipcMain.handle('localdb-upsert-cl-accounts', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
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

  // Omset
  ipcMain.handle('localdb-upsert-omset', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
      const stmt = localDb!.prepare(`INSERT INTO omset (
        id, business_id, date, regular, ojol, event, delivery, fitness, pool,
        user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(business_id, date) DO UPDATE SET
        regular=excluded.regular, ojol=excluded.ojol, event=excluded.event, delivery=excluded.delivery,
        fitness=excluded.fitness, pool=excluded.pool, user_id=excluded.user_id,
        created_at=excluded.created_at, updated_at=excluded.updated_at`);
      for (const r of data) {
        stmt.run(r.id, r.business_id, r.date, r.regular, r.ojol, r.event, r.delivery, 
                r.fitness, r.pool, r.user_id, r.created_at, Date.now());
      }
    });
    tx(rows);
    return { success: true };
  });

  ipcMain.handle('localdb-get-omset', async (event, businessId?: number, startDate?: string, endDate?: string) => {
    if (!localDb) return [];
    let query = 'SELECT * FROM omset';
    const params: any[] = [];
    
    if (businessId) {
      query += ' WHERE business_id = ?';
      params.push(businessId);
      
      if (startDate) {
        query += ' AND date >= ?';
        params.push(startDate);
      }
      
      if (endDate) {
        query += ' AND date <= ?';
        params.push(endDate);
      }
    }
    
    query += ' ORDER BY date DESC';
    
    const stmt = localDb.prepare(query);
    return stmt.all(...params);
  });

  // Printer configuration handlers
  ipcMain.handle('localdb-save-printer-config', async (event, printerType: string, systemPrinterName: string, extraSettings?: any) => {
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
    if (!printerService) return { success: true, mode: 'auto' };
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
  ipcMain.handle('log-printer2-print', async (event, transactionId: string, printer2ReceiptNumber: number, mode: 'auto' | 'manual', cycleNumber?: number, globalCounter?: number) => {
    if (!printerService) return { success: false };
    const result = printerService.logPrinter2Print(transactionId, printer2ReceiptNumber, mode, cycleNumber, globalCounter);
    return { success: result };
  });
  
  // Get Printer 2 audit log
  ipcMain.handle('get-printer2-audit-log', async (event, fromDate?: string, toDate?: string, limit?: number) => {
    if (!printerService) return { success: false, entries: [] };
    const entries = printerService.getPrinter2AuditLog(fromDate, toDate, limit || 100);
    return { success: true, entries };
  });

  // Log Printer 1 print
  ipcMain.handle('log-printer1-print', async (event, transactionId: string, printer1ReceiptNumber: number, globalCounter?: number) => {
    if (!printerService) return { success: false };
    const result = printerService.logPrinter1Print(transactionId, printer1ReceiptNumber, globalCounter);
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
  ipcMain.handle('localdb-upsert-printer-audits', async (event, payload: { printerType: 'receipt' | 'receiptize'; rows: any[] }) => {
    if (!localDb) return { success: false };
    if (!payload?.rows?.length) return { success: true, count: 0 };

    const now = Date.now();
    const { printerType, rows } = payload;

    try {
      const tx = localDb.transaction((data: any[]) => {
        if (printerType === 'receipt') {
          const deleteStmt = localDb!.prepare('DELETE FROM printer1_audit_log WHERE transaction_id = ? AND printer1_receipt_number = ? AND printed_at_epoch = ?');
          const insertStmt = localDb!.prepare(`
            INSERT INTO printer1_audit_log (transaction_id, printer1_receipt_number, global_counter, printed_at, printed_at_epoch, synced_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `);
          for (const row of data) {
            const transactionId = String(row.transaction_id);
            const receiptNumber = Number(row.printer1_receipt_number);
            const printedAtEpoch = Number(row.printed_at_epoch ?? (row.printed_at ? new Date(row.printed_at).getTime() : 0));
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
            const printedAtEpoch = Number(row.printed_at_epoch ?? (row.printed_at ? new Date(row.printed_at).getTime() : 0));
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
  ipcMain.handle('localdb-queue-offline-transaction', async (event, transactionData: any) => {
    if (!localDb) return { success: false, error: 'Database not available' };
    try {
      const stmt = localDb.prepare(`
        INSERT INTO offline_transactions (transaction_data, created_at, sync_status)
        VALUES (?, ?, 'pending')
      `);
      const result = stmt.run(JSON.stringify(transactionData), Date.now());
      
      // Queue transaction items
      if (transactionData.items && transactionData.items.length > 0) {
        const itemStmt = localDb.prepare(`
          INSERT INTO offline_transaction_items (offline_transaction_id, item_data)
          VALUES (?, ?)
        `);
        for (const item of transactionData.items) {
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
      return stmt.all();
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

  // Load the app - start with login page
  console.log('🔍 isDev:', isDev);
  if (isDev) {
    console.log('🔍 Development mode detected');
    // Wait a bit for Next.js to start, then load the login page
    setTimeout(async () => {
      console.log('🔍 Loading login page...');
      // Try port 3001 first (common alternative), then fallback to 3000
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

        // Try ports in order: 3000, 3001, 3002 (3000 is default Next.js port)
        const ports = [3000, 3001, 3002];
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
    mainWindow!.loadFile(path.join(__dirname, '../out/index.html'));
  }

  // Show windows when ready
  mainWindow!.once('ready-to-show', () => {
    mainWindow!.show();
    
    // Focus on the window
    if (isDev) {
      mainWindow!.focus();
    }
  });

  if (customerWindow) {
    customerWindow.once('ready-to-show', () => {
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
ipcMain.handle('print-receipt', async (event, data) => {
  try {
    console.log('📄 Printing receipt - Full data received:', JSON.stringify(data, null, 2));
    
    let printerName = data.printerName;
    let marginAdjustMm: number | undefined =
      typeof data.marginAdjustMm === 'number' && !Number.isNaN(data.marginAdjustMm)
        ? data.marginAdjustMm
        : undefined;
    let printerConfig: any | null = null;
    
    if (data.printerType && localDb) {
      console.log('🔍 Resolving printer configuration for type:', data.printerType);
      try {
        const allConfigs = localDb.prepare('SELECT * FROM printer_configs').all() as any[];
        console.log('📋 All printer configs in database:', allConfigs);
        
        printerConfig = localDb.prepare('SELECT * FROM printer_configs WHERE printer_type = ?')
          .get(data.printerType) as any;
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
ipcMain.handle('print-label', async (event, data) => {
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
        const allConfigs = localDb.prepare('SELECT * FROM printer_configs').all() as any[];
        console.log('📋 All printer configs in database:', JSON.stringify(allConfigs, null, 2));
      } catch (e) {
        console.error('Failed to list all configs:', e);
      }
      
      try {
        const config = localDb.prepare('SELECT * FROM printer_configs WHERE printer_type = ?').get(data.printerType) as any;
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
      line-height: 1.4;
      padding: 5mm ${rightPadding.toFixed(2)}mm 5mm ${leftPadding.toFixed(2)}mm;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .contact { text-align: center; font-size: 8pt; font-weight: 600; margin-bottom: 3mm; }
    .logo-container { text-align: center; margin-bottom: 2mm; }
    .logo { max-width: 100%; height: auto; max-height: 20mm; }
    .store-name { text-align: center; font-size: 13pt; font-weight: bold; margin-bottom: 2mm; }
    .branch { text-align: center; font-size: 11pt; font-weight: 600; margin-bottom: 2mm; }
    .address { text-align: center; font-size: 8pt; font-weight: 500; margin-bottom: 3mm; max-width: 100%; line-height: 1.5; }
    .transaction-type { text-align: center; font-size: 10pt; font-weight: 700; margin-bottom: 3mm; }
    .dashed-line { border-top: 1px dashed #000; margin: 3mm 0; }
    .info-line { display: flex; justify-content: space-between; margin-bottom: 1mm; }
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
    table { width: 100%; border-collapse: collapse; margin: 2mm 0; font-size: 9pt; }
    th { text-align: left; font-weight: 700; border-bottom: 1px solid #000; padding: 1mm 0; font-size: 8pt; }
    td { padding: 1mm 0; font-weight: 500; }
    .summary-line { display: flex; justify-content: space-between; margin-bottom: 1mm; font-size: 9pt; font-weight: 500; }
    .summary-label { font-weight: 500; }
    .summary-value { font-weight: 700; }
    .footer { margin-top: 5mm; font-size: 8pt; text-align: left; line-height: 1.4; font-weight: 500; }
  </style>
</head>
<body>
  <div class="contact">silahkan hubungi: 0813-9888-8568</div>
  
  ${logoDataUri ? `<div class="logo-container"><img src="${logoDataUri}" class="logo" alt="Momoyo Logo"></div>` : '<div class="store-name">MOMOYO</div>'}
  <div class="branch">${businessName}</div>
  <div class="address">Jl. Kalimantan no. 21, Kartoharjo<br>Kec. Kartoharjo, Kota Madiun</div>
  
  <div class="transaction-type">DINE IN 23</div>
  
  <div class="dashed-line"></div>
  
  <div class="info-line">
    <span class="info-label">Nomor Pesanan:</span>
    <span class="info-value order-number-value mono-value">1970326207362797570</span>
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
    <span class="info-value">Erika Farah</span>
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
      <td colspan="4" style="text-align: left; padding-bottom: 0.5mm;">Croissant</td>
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
    <p style="margin-top: 5mm;">Untuk layanan kemitraan dan partnership</p>
  </div>
</body>
</html>
  `;
}

// Generate test label HTML for 40x30mm label printer
function generateTestLabelHTML(printerName: string): string {
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
  </div>
</body>
</html>
  `;
}

// Generate label HTML for order items
function generateLabelHTML(data: any): string {
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
function generateReceiptHTML(data: any, businessName: string, options?: ReceiptFormattingOptions): string {
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
  const totalItems = items.reduce((sum: number, item: any) => sum + (item.quantity || 1), 0);
  
  // Generate items HTML
  const itemsHTML = items.map((item: any) => {
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
      line-height: 1.4;
      padding: 5mm ${rightPadding.toFixed(2)}mm 5mm ${leftPadding.toFixed(2)}mm;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .contact { text-align: center; font-size: 8pt; font-weight: 600; margin-bottom: 3mm; }
    .logo-container { text-align: center; margin-bottom: 2mm; }
    .logo { max-width: 100%; height: auto; max-height: 20mm; }
    .store-name { text-align: center; font-size: 13pt; font-weight: bold; margin-bottom: 2mm; }
    .branch { text-align: center; font-size: 11pt; font-weight: 600; margin-bottom: 2mm; }
    .address { text-align: center; font-size: 8pt; font-weight: 500; margin-bottom: 3mm; max-width: 100%; line-height: 1.5; }
    .transaction-type { text-align: center; font-size: 10pt; font-weight: 700; margin-bottom: 3mm; }
    .dashed-line { border-top: 1px dashed #000; margin: 3mm 0; }
    .info-line { display: flex; justify-content: space-between; margin-bottom: 1mm; }
    .info-label { font-size: 9pt; font-weight: 500; }
    .info-value { font-size: 9pt; font-weight: 700; }
    .order-number-value { font-size: 9pt; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin: 2mm 0; font-size: 9pt; }
    th { text-align: left; font-weight: 700; border-bottom: 1px solid #000; padding: 1mm 0; font-size: 8pt; }
    td { padding: 1mm 0; font-weight: 500; }
    .summary-line { display: flex; justify-content: space-between; margin-bottom: 1mm; font-size: 9pt; font-weight: 500; }
    .summary-label { font-weight: 500; }
    .summary-value { font-weight: 700; }
    .footer { margin-top: 5mm; font-size: 8pt; text-align: left; line-height: 1.4; font-weight: 500; }
  </style>
</head>
<body>
  <div class="contact">silahkan hubungi: 0813-9888-8568</div>
  
  ${logoDataUri ? `<div class="logo-container"><img src="${logoDataUri}" class="logo" alt="Momoyo Logo"></div>` : '<div class="store-name">MOMOYO</div>'}
  <div class="branch">${businessName}</div>
  <div class="address">Jl. Kalimantan no. 21, Kartoharjo<br>Kec. Kartoharjo, Kota Madiun</div>
  
  ${(() => {
    // Choose per-printer display number: Printer 1 uses printer1Counter, Printer 2 uses printer2Counter
    // Fall back to tableNumber, then '01'
    const isReceiptize = data.printerType === 'receiptizePrinter';
    const displayCounter = data.globalCounter ?? (isReceiptize ? data.printer2Counter : data.printer1Counter);
    const number = displayCounter ?? data.tableNumber ?? '01';
    const numStr = String(number).padStart(2, '0');
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
    <p style="margin-top: 5mm;">Untuk layanan kemitraan dan partnership</p>
  </div>
</body>
</html>
  `;
}

// Generate shift breakdown report HTML for printing
function generateShiftBreakdownHTML(shiftData: {
  user_name: string;
  shift_start: string;
  shift_end: string | null;
  modal_awal: number;
  statistics: { order_count: number; total_amount: number };
  productSales: Array<{ product_name: string; total_quantity: number; total_subtotal: number }>;
  paymentBreakdown: Array<{ payment_method_name: string; transaction_count: number }>;
  cashSummary: { cash_shift: number; cash_whole_day: number; total_cash_in_cashier: number };
  businessName?: string;
}): string {
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

  const printTime = formatDateTime(new Date().toISOString());
  const shiftStartTime = formatDateTime(shiftData.shift_start);
  const shiftEndTime = shiftData.shift_end ? formatDateTime(shiftData.shift_end) : 'Masih Berlangsung';

  // Generate product sales table rows
  const productRows = shiftData.productSales.map(product => `
    <tr>
      <td style="text-align: left; padding: 1mm 0;">${product.product_name}</td>
      <td style="text-align: right; padding: 1mm 0;">${product.total_quantity}</td>
      <td style="text-align: right; padding: 1mm 0;">${product.total_subtotal.toLocaleString('id-ID')}</td>
    </tr>
  `).join('');

  const totalProductQty = shiftData.productSales.reduce((sum, p) => sum + p.total_quantity, 0);
  const totalProductSubtotal = shiftData.productSales.reduce((sum, p) => sum + p.total_subtotal, 0);

  // Generate payment method rows
  const paymentRows = shiftData.paymentBreakdown.map(payment => `
    <tr>
      <td style="text-align: left; padding: 1mm 0;">${payment.payment_method_name || 'N/A'}</td>
      <td style="text-align: right; padding: 1mm 0;">${payment.transaction_count}</td>
    </tr>
  `).join('');

  const totalPaymentCount = shiftData.paymentBreakdown.reduce((sum, p) => sum + p.transaction_count, 0);

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
      line-height: 1.4;
      padding: 5mm 7mm;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .header {
      text-align: center;
      margin-bottom: 4mm;
    }
    .title {
      font-size: 11pt;
      font-weight: 700;
      margin-bottom: 2mm;
    }
    .business-name {
      font-size: 10pt;
      font-weight: 600;
      margin-bottom: 1mm;
    }
    .divider {
      border-top: 1px dashed #000;
      margin: 3mm 0;
    }
    .info-line {
      display: flex;
      justify-content: space-between;
      margin-bottom: 1mm;
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
      margin: 3mm 0 2mm 0;
      text-align: center;
      text-decoration: underline;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 2mm 0;
      font-size: 8pt;
    }
    th {
      text-align: left;
      font-weight: 700;
      border-bottom: 1px solid #000;
      padding: 1mm 0;
      font-size: 8pt;
    }
    th.right, td.right {
      text-align: right;
    }
    td {
      padding: 1mm 0;
      font-weight: 500;
    }
    .total-row {
      border-top: 2px solid #000;
      font-weight: 700;
      background-color: #f0f0f0;
    }
    .summary {
      margin-top: 3mm;
      font-size: 8pt;
    }
    .summary-line {
      display: flex;
      justify-content: space-between;
      margin-bottom: 1mm;
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
  <div class="header">
    <div class="title">LAPORAN SHIFT</div>
    <div class="business-name">${shiftData.businessName || 'Momoyo Bakery Kalimantan'}</div>
  </div>

  <div class="divider"></div>

  <div class="info-line">
    <span class="info-label">Cashier:</span>
    <span class="info-value">${shiftData.user_name}</span>
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
    <span class="info-value">${shiftData.modal_awal.toLocaleString('id-ID')}</span>
  </div>

  <div class="divider"></div>

  <div class="section-title">PRODUCT SALES BREAKDOWN</div>
  <table>
    <thead>
      <tr>
        <th>Product</th>
        <th class="right">Qty</th>
        <th class="right">Subtotal</th>
      </tr>
    </thead>
    <tbody>
      ${productRows || '<tr><td colSpan="3" style="text-align: center;">Tidak ada produk</td></tr>'}
      <tr class="total-row">
        <td>TOTAL</td>
        <td class="right">${totalProductQty}</td>
        <td class="right">${totalProductSubtotal.toLocaleString('id-ID')}</td>
      </tr>
    </tbody>
  </table>

  <div class="divider"></div>

  <div class="section-title">PAYMENT METHOD BREAKDOWN</div>
  <table>
    <thead>
      <tr>
        <th>Payment Method</th>
        <th class="right">Count</th>
      </tr>
    </thead>
    <tbody>
      ${paymentRows || '<tr><td colSpan="2" style="text-align: center;">Tidak ada transaksi</td></tr>'}
      <tr class="total-row">
        <td>TOTAL</td>
        <td class="right">${totalPaymentCount}</td>
      </tr>
    </tbody>
  </table>

  <div class="divider"></div>

  <div class="summary">
    <div class="summary-line">
      <span class="summary-label">Total Pesanan:</span>
      <span class="summary-value">${shiftData.statistics.order_count}</span>
    </div>
    <div class="summary-line">
      <span class="summary-label">Total Transaksi:</span>
      <span class="summary-value">${shiftData.statistics.total_amount.toLocaleString('id-ID')}</span>
    </div>
    <div class="summary-line">
      <span class="summary-label">Cash (Shift):</span>
      <span class="summary-value">${shiftData.cashSummary.cash_shift.toLocaleString('id-ID')}</span>
    </div>
    <div class="summary-line">
      <span class="summary-label">Cash (Hari):</span>
      <span class="summary-value">${shiftData.cashSummary.cash_whole_day.toLocaleString('id-ID')}</span>
    </div>
    <div class="summary-line">
      <span class="summary-label">Cash in Cashier:</span>
      <span class="summary-value">${shiftData.cashSummary.total_cash_in_cashier.toLocaleString('id-ID')}</span>
    </div>
  </div>

  <div class="divider"></div>

  <div class="info-line" style="margin-top: 3mm;">
    <span class="info-label">Waktu Print:</span>
    <span class="info-value">${printTime}</span>
  </div>
</body>
</html>
  `;
}

// Print shift breakdown report
ipcMain.handle('print-shift-breakdown', async (event, data: {
  user_name: string;
  shift_start: string;
  shift_end: string | null;
  modal_awal: number;
  statistics: { order_count: number; total_amount: number };
  productSales: Array<{ product_name: string; total_quantity: number; total_subtotal: number }>;
  paymentBreakdown: Array<{ payment_method_name: string; transaction_count: number }>;
  cashSummary: { cash_shift: number; cash_whole_day: number; total_cash_in_cashier: number };
  business_id?: number;
  printerType?: string;
}) => {
  try {
    let printerName = data.printerType || 'receiptPrinter';
    
    // Get printer name from config if printerType is provided
    if (data.printerType && localDb) {
      try {
        const config = localDb.prepare('SELECT * FROM printer_configs WHERE printer_type = ?').get(data.printerType) as any;
        if (config && config.system_printer_name) {
          printerName = config.system_printer_name;
        }
      } catch (error) {
        console.error('Error fetching printer config:', error);
      }
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

    // Generate HTML
    const htmlContent = generateShiftBreakdownHTML({
      ...data,
      businessName
    });

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

    await printWindow.loadURL(`data:text/html,${encodeURIComponent(htmlContent)}`);

    const printOptions = {
      silent: true,
      printBackground: false,
      deviceName: printerName,
    };

    await printWindow.webContents.print(printOptions);
    
    // Close print window after a delay
    setTimeout(() => {
      if (printWindow) {
        printWindow.close();
        printWindow = null;
      }
    }, 1000);

    console.log('✅ [SHIFT PRINT] Shift breakdown printed successfully');
    return { success: true };
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
  } catch (error: any) {
    console.error('Failed to list printers:', error);
    return { success: false, error: error?.message || String(error), printers: [] };
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
    customerWindow.loadFile(path.join(__dirname, '../out/customer-display.html'));
    customerWindow.show();
  }

  return { success: true, message: 'Customer display created successfully' };
});

