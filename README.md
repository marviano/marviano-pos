# Marviano POS - Point of Sale System

A comprehensive desktop Point of Sale system built with Next.js, Electron, and MySQL with advanced offline capabilities.

## 🚀 Features

### Core POS Functionality
- **Product Management**: Complete product catalog with categories and pricing
- **Shopping Cart**: Advanced cart with product customization support
- **Transaction Processing**: Secure payment handling and receipt generation
- **User Authentication**: Role-based access control with secure login

### Advanced Features
- **Product Customization**: Dynamic product options with real-time price adjustments
- **Dual-Display Support**: Automatic customer display on secondary monitor
- **Slideshow Management**: Promotional content display for customers
- **Real-time Order Updates**: Live order status on customer display

### Offline System
- **Comprehensive Offline Support**: Full POS functionality without internet
- **SQLite Local Database**: Complete data replication for offline operation
- **Automatic Synchronization**: Real-time sync when connection is restored
- **Connection Monitoring**: Continuous internet and database connectivity checks
- **Seamless Fallback**: Automatic transition between online and offline modes

## 🖥️ Desktop Application (Electron)

### Dual-Display Support
- **Main POS Window**: Full-screen cashier interface (1366x768 optimized)
- **Customer Display**: Secondary monitor for order display and promotions
- **Automatic Detection**: Auto-creates customer display on secondary monitor
- **Window Management**: Smart resizing from login (800x432) to full-screen POS

### Window Controls
- **Login Mode**: Compact 800x432 window for authentication
- **POS Mode**: Full-screen operation after successful login
- **Customer Display**: Always-on-top promotional and order display
- **System Controls**: Minimize, close, and customer display management

## 🛠️ Development Setup

### Prerequisites
- Node.js 18+ 
- MySQL 8.0+
- Windows 10/11 (primary platform)

### Environment Configuration
Create a `.env` file in the root directory:
```env
# Database Configuration
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=adad
DB_NAME=marviano_pos
DB_PORT=3306

# Application
NODE_ENV=development
```
⚠️ **Important**: Update `DB_PASSWORD` and `DB_NAME` to match your actual database credentials.

### Installation & Development
```bash
# Install dependencies
npm install

# Development mode (Next.js + Electron)
npm run electron-dev

# Build for production
npm run build-electron
npm run dist
```

### Password Encryption
To encrypt passwords for user accounts:
```bash
node scripts/hash-password.js "your password here"
```

## 🏗️ System Architecture

### Business ID Configuration
- **Business ID**: Now dynamically uses `user.selectedBusinessId` from the authenticated user
  - The system supports multiple businesses through user business selection during login
  - All components, API routes, and database queries use the selected business ID
  - Fallback to `business_id = 14` for backward compatibility when not set
  - Location: All React components, API routes, and Electron IPC handlers accept dynamic businessId

## 🎨 POS Interface Layout

### Main POS Structure
```
src/app/page.tsx (Main Entry with Authentication)
├── Top Bar (h-10 bg-white)
│   ├── Title & User Info (left): "2 Fat Guys & Ueno POS"
│   ├── OfflineIndicator (center): Connection status
│   └── Controls (right): Customer Display, Logout, Minimize, Close
│
└── POSLayout.tsx (Main POS Interface)
    └── <div className="flex h-screen bg-gray-100 overflow-hidden">
        ├── LeftSidebar.tsx (w-40 bg-blue-900)
        │   ├── Logo (top): Green circle with "E"
        │   ├── Menu Items (middle): Kasir, Pesanan, Pesan Antar, etc.
        │   └── Status (bottom): Online indicator with minimize button
        │
        ├── CenterContent.tsx (flex-1)
        │   ├── Cart Area (w-[40%])
        │   │   ├── Top Navigation: Masuk/Mendaftar buttons
        │   │   ├── Cart Items Display (scrollable)
        │   │   │   └── Product Customization Display
        │   │   └── Cart Summary (sticky bottom)
        │   │       ├── Price totals with customization adjustments
        │   │       └── Action Buttons: Pesanan Tertunda, Menerima Pembayaran
        │   │
        │   └── Product Grid (w-[60%])
        │       ├── Product Cards (scrollable, 3-column grid)
        │       │   └── Product Customization Modal Integration
        │       └── Action Buttons (fixed footer): Ambil Pesanan, Kupon, Aktivitas, Menukarkan
        │
        └── RightSidebar.tsx (w-48 bg-blue-100)
            └── Category Selector (from database)
```

### Component Architecture
- **Main Layout:** `src/app/page.tsx` - Authentication wrapper with top bar
- **POS Container:** `src/components/POSLayout.tsx` - Main POS interface coordinator
- **Left Navigation:** `src/components/LeftSidebar.tsx` (w-40 / 160px)
- **Cart & Products:** `src/components/CenterContent.tsx` (Cart: 40% | Products: 60%)
- **Categories:** `src/components/RightSidebar.tsx` (w-48 / 192px)
- **Offline System:** `src/components/OfflineIndicator.tsx` - Connection status
- **Debug Tools:** `src/components/ConnectionDebugPanel.tsx` - Troubleshooting
- **Product Customization:** `src/components/ProductCustomizationModal.tsx`
- **Customer Display:** `src/components/CustomerDisplay.tsx` - Secondary monitor

### Development Guidelines
- **Top bar controls** → Edit `src/app/page.tsx`
- **Left menu items** → Edit `src/components/LeftSidebar.tsx`
- **Cart area** → Edit left side of `src/components/CenterContent.tsx`
- **Product grid** → Edit right side of `src/components/CenterContent.tsx`
- **Category sidebar** → Edit `src/components/RightSidebar.tsx`
- **Offline features** → Edit `src/components/OfflineIndicator.tsx`
- **Product customization** → Edit `src/components/ProductCustomizationModal.tsx`

### 1366x768 Resolution Optimizations
- **Sidebar widths**: LeftSidebar `w-40` (160px), RightSidebar `w-48` (192px) - Total: 352px
- **Content area**: 1366 - 352 = **1014px available**
- **Reduced padding**: `p-4` instead of `p-6` for optimal space utilization
- **Compact elements**: Smaller product cards, buttons, and text sizes
- **Top bar**: `h-10` instead of `h-12` for more vertical space

---

## 🔌 API Endpoints

### Core POS APIs
- **`GET /api/categories`** - Fetch product categories from database
  - Returns: Unique product types (`jenis`) for the selected business
  - Fallback: Mock data if database unavailable
- **`GET /api/products?jenis=<category>`** - Fetch products by category
  - Parameters: `jenis` (product type/category)
  - Returns: Active products filtered by category
  - Fallback: Mock data if database unavailable

### Data Synchronization
- **`GET /api/sync`** - Comprehensive data synchronization
  - Downloads ALL POS tables for complete offline functionality
  - Tables: users, businesses, products, categories, ingredients, cogs, contacts, teams, source, pekerjaan
  - Returns: Complete dataset with record counts
- **`GET /api/health-check`** - Connection status monitoring
  - Tests database connectivity
  - Used by offline sync service for connection monitoring

### Product Management
- **`GET /api/products/[id]/customizations`** - Get product customization options
  - Returns: Available customization types and options for specific product
  - Used by: ProductCustomizationModal component

### Slideshow Management
- **`GET /api/slideshow/images`** - Fetch slideshow images
  - Returns: Available promotional images from `/public/images/slideshow/`
  - Used by: Customer display slideshow system

### Authentication
- **`POST /api/auth/login`** - User authentication
  - Handles login credentials and session management
  - Returns: User data and authentication tokens

---

## 🗄️ Database Structure - POS Relevant Tables

### Core Tables

#### 1. Users Table
```sql
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `password` varchar(255) DEFAULT NULL,
  `name` varchar(255) DEFAULT NULL,
  `googleId` varchar(255) DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `role_id` int NOT NULL,
  `organization_id` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `googleId` (`googleId`),
  KEY `role_id` (`role_id`),
  KEY `idx_users_organization` (`organization_id`),
  KEY `idx_users_email_password` (`email`,`password`),
  CONSTRAINT `users_ibfk_1` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `users_ibfk_2` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=73 DEFAULT CHARSET=utf8mb3;
```

#### 2. Organizations Table
```sql
CREATE TABLE `organizations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `slug` varchar(100) NOT NULL,
  `owner_user_id` int NOT NULL,
  `subscription_status` enum('trial','active','inactive','cancelled') DEFAULT 'trial',
  `subscription_plan` varchar(50) DEFAULT 'basic',
  `trial_ends_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`),
  KEY `owner_user_id` (`owner_user_id`),
  CONSTRAINT `organizations_ibfk_1` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb3;
```

#### 3. Businesses Table
```sql
CREATE TABLE `businesses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `permission_name` varchar(255) NOT NULL,
  `organization_id` int NOT NULL,
  `management_group_id` int DEFAULT NULL,
  `image_url` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `permission_name` (`permission_name`),
  KEY `idx_businesses_organization` (`organization_id`),
  KEY `idx_businesses_management_group` (`management_group_id`),
  CONSTRAINT `businesses_ibfk_2` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `businesses_ibfk_3` FOREIGN KEY (`management_group_id`) REFERENCES `management_groups` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=26 DEFAULT CHARSET=utf8mb3;
```

#### 4. Products Table (Main POS Products)
```sql
CREATE TABLE `products` (
  `id` int NOT NULL AUTO_INCREMENT,
  `business_id` int NOT NULL COMMENT 'Reference to businesses table',
  `menu_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `nama` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `satuan` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `kategori` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `jenis` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Jenis produk dari Excel',
  `keterangan` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT 'Keterangan dari Excel',
  `harga_beli` decimal(10,2) DEFAULT NULL COMMENT 'Harga beli dari Excel',
  `ppn` decimal(5,2) DEFAULT NULL COMMENT 'PPN dari Excel',
  `harga_jual` int NOT NULL,
  `harga_khusus` decimal(10,2) DEFAULT NULL COMMENT 'Harga khusus dari Excel',
  `harga_online` decimal(10,2) DEFAULT NULL COMMENT 'Harga online dari Excel',
  `fee_kerja` decimal(10,2) DEFAULT NULL COMMENT 'Fee kerja dari Excel',
  `status` enum('active','inactive') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_menu_code_business` (`menu_code`,`business_id`),
  KEY `idx_business_id` (`business_id`),
  KEY `idx_kategori` (`kategori`),
  KEY `idx_status` (`status`),
  KEY `idx_products_jenis` (`jenis`),
  KEY `idx_products_harga_beli` (`harga_beli`),
  KEY `idx_products_harga_khusus` (`harga_khusus`),
  KEY `idx_products_harga_online` (`harga_online`),
  CONSTRAINT `products_ibfk_1` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=223 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Restaurant Products';
```

### Inventory & COGS Tables

#### 5. Ingredients Table
```sql
CREATE TABLE `ingredients` (
  `id` int NOT NULL AUTO_INCREMENT,
  `ingredient_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `nama` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `kategori` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `satuan_beli` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `isi_satuan_beli` decimal(10,2) NOT NULL,
  `satuan_keluar` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `harga_beli` int NOT NULL,
  `stok_min` int DEFAULT '0',
  `status` enum('active','inactive') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'active',
  `business_id` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_ingredient_code_business` (`ingredient_code`,`business_id`),
  KEY `business_id` (`business_id`),
  CONSTRAINT `ingredients_ibfk_1` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=952 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### 6. COGS Table (Cost of Goods Sold)
```sql
CREATE TABLE `cogs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `menu_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ingredient_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `amount` decimal(10,3) NOT NULL DEFAULT '0.000',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_product_ingredient` (`menu_code`,`ingredient_code`),
  KEY `idx_menu_code` (`menu_code`),
  KEY `idx_ingredient_code` (`ingredient_code`)
) ENGINE=InnoDB AUTO_INCREMENT=4940 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Tabel COGS untuk menghubungkan produk dengan bahan baku dan jumlahnya';
```

### Authorization Tables

#### 7. Roles Table
```sql
CREATE TABLE `roles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `organization_id` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  KEY `idx_roles_organization` (`organization_id`),
  CONSTRAINT `roles_ibfk_1` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=60 DEFAULT CHARSET=utf8mb3;
```

#### 8. Permissions Table
```sql
CREATE TABLE `permissions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `category_id` int DEFAULT NULL,
  `organization_id` int DEFAULT NULL,
  `status` enum('active','inactive') NOT NULL DEFAULT 'active',
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  KEY `category_id` (`category_id`),
  KEY `idx_permissions_organization` (`organization_id`),
  KEY `idx_permissions_status` (`status`),
  CONSTRAINT `permissions_ibfk_1` FOREIGN KEY (`category_id`) REFERENCES `permission_categories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `permissions_ibfk_2` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=211 DEFAULT CHARSET=utf8mb3;
```

#### 9. Role Permissions Table
```sql
CREATE TABLE `role_permissions` (
  `role_id` int NOT NULL,
  `permission_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`role_id`,`permission_id`),
  KEY `permission_id` (`permission_id`),
  CONSTRAINT `role_permissions_ibfk_1` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `role_permissions_ibfk_2` FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
```

### Key Relationships for POS Operations:
- **User → Organization → Business** (Multi-tenant structure)
- **Products → Business** (Products belong to specific business/location)
- **Products → COGS → Ingredients** (Cost tracking and inventory)
- **Users → Roles → Permissions** (Access control)

### Important Fields for POS:
- **Products:**
  - `harga_jual`: Main selling price
  - `harga_khusus`: Special/discount price
  - `harga_online`: Online order price
  - `jenis`: Product type (used for category filtering in POS)
  - `kategori`: Product category
  - `status`: active/inactive
  
- **Users:**
  - `role_id`: Determines what operations user can perform
  - `organization_id`: Which organization they belong to

---

## ✅ Implementation Status

### 🎉 Completed Features:

#### 1. Core POS Functionality
- **✅ Category Loading**: Dynamic category fetching from database for selected business
- **✅ Product Management**: Complete product catalog with category filtering
- **✅ Shopping Cart**: Advanced cart with quantity management and customization support
- **✅ Transaction Processing**: Payment handling with order status updates
- **✅ User Authentication**: Secure login system with role-based access

#### 2. Advanced Features
- **✅ Product Customization**: Dynamic product options with real-time price adjustments
- **✅ Customer Display**: Dual-monitor support with automatic secondary display detection
- **✅ Slideshow Management**: Promotional content system for customer display
- **✅ Real-time Updates**: Live order status synchronization between displays

#### 3. Offline System
- **✅ SQLite Local Database**: Complete POS data replication for offline operation
- **✅ Automatic Synchronization**: Real-time sync when internet connection is restored
- **✅ Connection Monitoring**: Continuous internet and database connectivity checks
- **✅ Seamless Fallback**: Automatic transition between online and offline modes
- **✅ Offline Indicators**: Real-time connection status display with debug tools

#### 4. Desktop Application
- **✅ Electron Integration**: Full desktop application with dual-display support
- **✅ Window Management**: Smart resizing from login to full-screen POS mode
- **✅ IPC Communication**: Secure communication between main and renderer processes
- **✅ Customer Display**: Always-on-top promotional and order display window

### 🔄 Current Development:
- Enhanced reporting and analytics dashboard
- Advanced inventory management with low-stock alerts
- Multi-business support (removing hard-coded business_id)
- Receipt printing integration
- Advanced user role management

### 📋 Future Enhancements:
- Mobile app integration
- Cloud backup and synchronization
- Advanced analytics and reporting
- Multi-language support
- Barcode scanning integration

---

## 🔄 Offline System Architecture

### How It Works
The POS system includes a comprehensive offline capability that ensures uninterrupted operation even without internet connectivity.

#### 1. **Dual Database System**
- **Primary**: MySQL database for online operations
- **Secondary**: SQLite local database for offline operations
- **Synchronization**: Automatic bidirectional sync when connection is available

#### 2. **Connection Monitoring**
- **Real-time Monitoring**: Continuous checks every 5 seconds
- **Multiple Endpoints**: Tests internet connectivity via Google, Cloudflare, and HTTPBin
- **Database Health**: Monitors local MySQL database connectivity
- **Visual Indicators**: Real-time status display in the top bar

#### 3. **Automatic Fallback**
- **Online Mode**: Uses MySQL database with real-time data
- **Offline Mode**: Seamlessly switches to SQLite local database
- **Sync on Reconnect**: Automatically syncs all data when connection is restored
- **No Data Loss**: All operations continue normally in offline mode

#### 4. **Local SQLite Tables**
The offline database includes complete replication of all POS tables:
- `users` - User accounts and authentication
- `businesses` - Business information
- `products` - Complete product catalog
- `categories` - Product categories
- `ingredients` - Inventory items
- `cogs` - Cost of goods sold
- `contacts` - Customer information
- `teams` - Team management
- `source` - Lead sources
- `pekerjaan` - Job categories

### Offline Components
- **`OfflineSyncService`**: Core synchronization engine
- **`OfflineIndicator`**: Real-time connection status display
- **`ConnectionDebugPanel`**: Advanced troubleshooting tools
- **`offlineDataFetcher`**: Smart data fetching with fallback

---

## 🛠️ Troubleshooting Guide

### Common Issues & Solutions

#### 1. **Connection Issues**
**Problem**: Offline indicator shows "No Connection"
**Solutions**:
- Check internet connectivity
- Verify database credentials in `.env` file
- Use Connection Debug Panel (purple bug icon) for detailed diagnostics
- Restart the application

#### 2. **Customer Display Not Appearing**
**Problem**: Secondary monitor not detected
**Solutions**:
- Ensure secondary monitor is connected and enabled
- Check Windows display settings
- Use "Customer Display" button in top bar to manually create
- Verify monitor is set as extended display (not duplicate)

#### 3. **Database Connection Errors**
**Problem**: "Database Error" in offline indicator
**Solutions**:
- Verify MySQL service is running
- Check database credentials in `.env` file
- Ensure database `marviano_pos` exists
- Test connection with MySQL client

#### 4. **Sync Issues**
**Problem**: Data not syncing between online/offline
**Solutions**:
- Check internet connectivity
- Use manual sync button in offline indicator
- Restart application to trigger fresh sync
- Check console logs for sync errors

#### 5. **Performance Issues**
**Problem**: Slow loading or unresponsive interface
**Solutions**:
- Check available disk space (SQLite database grows over time)
- Clear browser cache and restart
- Verify system resources (RAM, CPU)
- Check for large product catalogs

### Debug Tools
- **Connection Debug Panel**: Click purple bug icon in bottom-right
- **Browser Console**: Press F12 for detailed logs
- **Electron DevTools**: Available in development mode
- **Sync Status**: Check offline indicator for last sync time

---

## 📱 Customer Display System

### Features
- **Automatic Detection**: Creates display on secondary monitor automatically
- **Order Display**: Shows current order status and items
- **Slideshow**: Promotional content rotation
- **Real-time Updates**: Live synchronization with main POS

### Management
- **Slideshow Manager**: Access via Settings menu
- **Manual Control**: Create/remove customer display via top bar button
- **Content Management**: Add/edit promotional slides
- **Image Support**: Automatic detection of images in `/public/images/slideshow/`

---

## 🔐 Security & Authentication

### User Management
- **Role-based Access**: Different permission levels for users
- **Secure Authentication**: Bcrypt password hashing
- **Session Management**: Secure session handling
- **Password Encryption**: Use `node scripts/hash-password.js` for new passwords

### Data Protection
- **Local Encryption**: SQLite database stored securely
- **Network Security**: HTTPS in production
- **Access Control**: Role-based feature access
- **Audit Trail**: User action logging (planned)

---

## 📊 System Requirements

### Minimum Requirements
- **OS**: Windows 10/11 (64-bit)
- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: 2GB free space
- **Display**: 1366x768 minimum resolution
- **Network**: Internet connection for initial setup and sync

### Recommended Setup
- **OS**: Windows 11 (64-bit)
- **RAM**: 8GB or more
- **Storage**: SSD with 5GB free space
- **Display**: Dual monitors (1920x1080 each)
- **Network**: Stable broadband connection
- **Database**: MySQL 8.0+ with dedicated server

---

## 🚀 Getting Started

### Quick Start
1. **Install Dependencies**: `npm install`
2. **Setup Database**: Create MySQL database and update `.env`
3. **Start Development**: `npm run electron-dev`
4. **Login**: Use default credentials or create new user
5. **Setup Displays**: Connect secondary monitor for customer display

### Production Deployment
1. **Build Application**: `npm run build-electron`
2. **Create Installer**: `npm run dist`
3. **Install**: Run the generated installer
4. **Configure**: Update database settings
5. **Launch**: Start the POS application

---

## 📞 Support & Maintenance

### Regular Maintenance
- **Database Backup**: Regular MySQL database backups
- **Log Monitoring**: Check application logs for errors
- **Sync Verification**: Ensure offline sync is working
- **Performance Monitoring**: Monitor system resources

### Updates
- **Application Updates**: Regular feature and security updates
- **Database Migrations**: Automatic schema updates
- **Offline Sync**: Ensures all systems stay synchronized
- **Backup Strategy**: Always backup before major updates