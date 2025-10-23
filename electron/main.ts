import { app, BrowserWindow, Menu, ipcMain, screen } from 'electron';
import Database from 'better-sqlite3';
import * as path from 'path';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Global references to windows
let mainWindow: BrowserWindow | null = null;
let customerWindow: BrowserWindow | null = null;
let printWindow: BrowserWindow | null = null;
let localDb: Database.Database | null = null;

function createWindows(): void {
  // Initialize local SQLite (offline storage) - TEMPORARILY DISABLED
  try {
    console.log('🔍 SQLite database temporarily disabled for testing');
    localDb = null; // Disable database for now
    
    // Database creation temporarily disabled
    /*
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
        keterangan TEXT,
        harga_beli REAL,
        ppn REAL,
        harga_jual INTEGER NOT NULL,
        harga_khusus REAL,
        harga_online REAL,
        fee_kerja REAL,
        status TEXT DEFAULT 'active',
        created_at TEXT,
        updated_at INTEGER,
        has_customization INTEGER DEFAULT 0
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
      
      -- Legacy tables for backward compatibility
      CREATE TABLE IF NOT EXISTS categories (
        jenis TEXT PRIMARY KEY,
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
    `);
    */
    
    console.log('✅ SQLite database temporarily disabled for testing');
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
  ipcMain.handle('localdb-upsert-categories', async (event, rows: { jenis: string; updated_at?: number }[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: { jenis: string; updated_at?: number }[]) => {
      const stmt = localDb!.prepare('INSERT INTO categories (jenis, updated_at) VALUES (?, ?) ON CONFLICT(jenis) DO UPDATE SET updated_at=excluded.updated_at');
      for (const r of data) {
        stmt.run(r.jenis, r.updated_at || Date.now());
      }
    });
    tx(rows);
    return { success: true };
  });
  ipcMain.handle('localdb-get-categories', async () => {
    if (!localDb) return [];
    const stmt = localDb.prepare('SELECT jenis, updated_at FROM categories ORDER BY jenis ASC');
    return stmt.all();
  });
  ipcMain.handle('localdb-upsert-products', async (event, rows: any[]) => {
    if (!localDb) return { success: false };
    const tx = localDb.transaction((data: any[]) => {
      const stmt = localDb!.prepare(`INSERT INTO products (
        id, business_id, menu_code, nama, satuan, kategori, jenis, keterangan,
        harga_beli, ppn, harga_jual, harga_khusus, harga_online, fee_kerja, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        business_id=excluded.business_id,
        menu_code=excluded.menu_code,
        nama=excluded.nama,
        satuan=excluded.satuan,
        kategori=excluded.kategori,
        jenis=excluded.jenis,
        keterangan=excluded.keterangan,
        harga_beli=excluded.harga_beli,
        ppn=excluded.ppn,
        harga_jual=excluded.harga_jual,
        harga_khusus=excluded.harga_khusus,
        harga_online=excluded.harga_online,
        fee_kerja=excluded.fee_kerja,
        status=excluded.status,
        updated_at=excluded.updated_at`);
      for (const r of data) {
        stmt.run(
          r.id, r.business_id, r.menu_code, r.nama, r.satuan || '', r.kategori, r.jenis, r.keterangan || null,
          r.harga_beli || null, r.ppn || null, r.harga_jual, r.harga_khusus || null, 
          r.harga_online || null, r.fee_kerja || null, r.status, Date.now()
        );
      }
    });
    tx(rows);
    return { success: true };
  });
  ipcMain.handle('localdb-get-products-by-jenis', async (event, jenis: string) => {
    if (!localDb) return [];
    const stmt = localDb.prepare(`SELECT 
      id, business_id, menu_code, nama, satuan, kategori, jenis, keterangan,
      harga_beli, ppn, harga_jual, harga_khusus, harga_online, fee_kerja, status 
      FROM products WHERE jenis = ? AND status = "active" ORDER BY nama ASC`);
    return stmt.all(jenis);
  });
  ipcMain.handle('localdb-get-all-products', async () => {
    if (!localDb) return [];
    const stmt = localDb.prepare(`SELECT 
      id, business_id, menu_code, nama, satuan, kategori, jenis, keterangan,
      harga_beli, ppn, harga_jual, harga_khusus, harga_online, fee_kerja, status 
      FROM products WHERE status = "active" ORDER BY nama ASC`);
    return stmt.all();
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
      const stmt = localDb.prepare('SELECT * FROM ingredients WHERE business_id = ? AND status = "active" ORDER BY nama ASC');
      return stmt.all(businessId);
    } else {
      const stmt = localDb.prepare('SELECT * FROM ingredients WHERE status = "active" ORDER BY nama ASC');
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

  // Printer configuration handlers
  ipcMain.handle('localdb-save-printer-config', async (event, printerType: string, systemPrinterName: string) => {
    if (!localDb) return { success: false };
    try {
      const stmt = localDb.prepare(`INSERT INTO printer_configs (id, printer_type, system_printer_name, created_at, updated_at) 
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET 
        system_printer_name=excluded.system_printer_name, updated_at=excluded.updated_at`);
      const now = Date.now();
      stmt.run(printerType, printerType, systemPrinterName, now, now);
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
    console.log('Printing receipt:', data);
    
    // Get the sender's webContents to access printing methods
    const sender = event.sender;
    
    if (data.type === 'test') {
      // Create a hidden window for printing to avoid darkening the main window
      if (printWindow) {
        printWindow.close();
      }
      
      printWindow = new BrowserWindow({
        width: 800,
        height: 600,
        show: false, // Hidden window
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        }
      });
      
      const printOptions = {
        silent: true, // Don't show print dialog - print directly
        printBackground: false,
        deviceName: data.printerName || undefined
      };
      
      // Create a simple HTML content for the test print
      const htmlContent = `
        <html>
          <head>
            <title>Test Print</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 20px; }
              .header { text-align: center; font-size: 18px; font-weight: bold; margin-bottom: 20px; }
              .content { font-size: 14px; line-height: 1.5; }
              .footer { margin-top: 30px; font-size: 12px; text-align: center; }
            </style>
          </head>
          <body>
            <div class="header">TEST PRINT - ${data.printerType?.toUpperCase() || 'PRINTER'}</div>
            <div class="content">
              <p>This is a test print to verify your printer is working correctly.</p>
              <p><strong>Printer:</strong> ${data.printerName}</p>
              <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
              <p><strong>Type:</strong> ${data.printerType}</p>
              <br>
              <p>If you can see this, your printer is configured correctly!</p>
            </div>
            <div class="footer">
              <p>Marviano POS System - Test Print</p>
            </div>
          </body>
        </html>
      `;
      
      // Load the HTML content in the hidden window
      await printWindow.loadURL(`data:text/html,${encodeURIComponent(htmlContent)}`);
      
      // Wait a moment for the content to load, then print
      setTimeout(() => {
        printWindow!.webContents.print(printOptions, (success: boolean, errorType: string) => {
          if (success) {
            console.log('✅ Test print sent successfully');
          } else {
            console.error('❌ Test print failed:', errorType);
          }
          // Close the print window after printing
          setTimeout(() => {
            if (printWindow) {
              printWindow.close();
              printWindow = null;
            }
          }, 1000);
        });
      }, 1000);
      
      return { success: true };
    } else {
      // For regular receipts, implement your receipt printing logic here
      console.log('Regular receipt printing not implemented yet');
      return { success: false, error: 'Regular receipt printing not implemented yet' };
    }
  } catch (error) {
    console.error('Error in print-receipt handler:', error);
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

