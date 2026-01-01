import { getMySQLPool, executeUpdate } from './mysqlDb';

/**
 * MySQL Schema Initialization
 * Creates all necessary tables based on the MySQL schema from salespulse.cc VPS
 */

export async function initializeMySQLSchema(): Promise<void> {
  console.log('📋 Initializing MySQL schema...');
  
  const tables = [
    // Users table
    `CREATE TABLE IF NOT EXISTS users (
      id INT NOT NULL AUTO_INCREMENT,
      email VARCHAR(255) NOT NULL,
      password VARCHAR(255) DEFAULT NULL,
      name VARCHAR(255) DEFAULT NULL,
      googleId VARCHAR(255) DEFAULT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      role_id INT NOT NULL,
      organization_id INT NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY email (email),
      UNIQUE KEY googleId (googleId),
      KEY role_id (role_id),
      KEY idx_users_organization (organization_id),
      KEY idx_users_email_password (email, password)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3`,

    // Businesses table
    `CREATE TABLE IF NOT EXISTS businesses (
      id INT NOT NULL AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      permission_name VARCHAR(255) NOT NULL,
      organization_id INT NOT NULL,
      status ENUM('active','inactive') NOT NULL DEFAULT 'active',
      management_group_id INT DEFAULT NULL,
      image_url VARCHAR(255) DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY permission_name (permission_name),
      KEY idx_businesses_organization (organization_id),
      KEY idx_businesses_management_group (management_group_id),
      KEY idx_businesses_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3`,

    // Category1 table
    `CREATE TABLE IF NOT EXISTS category1 (
      id INT NOT NULL AUTO_INCREMENT,
      name VARCHAR(100) CHARACTER SET utf8mb4 NOT NULL,
      description TEXT CHARACTER SET utf8mb4,
      display_order INT DEFAULT '0',
      is_active TINYINT(1) DEFAULT '1',
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY unique_category1_name (name),
      KEY idx_category1_active (is_active),
      KEY idx_category1_display_order (display_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Category2 table
    `CREATE TABLE IF NOT EXISTS category2 (
      id INT NOT NULL AUTO_INCREMENT,
      name VARCHAR(100) CHARACTER SET utf8mb4 NOT NULL,
      description TEXT CHARACTER SET utf8mb4,
      display_order INT DEFAULT '0',
      is_active TINYINT(1) DEFAULT '1',
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY unique_category2_name_business (name),
      KEY idx_category2_active (is_active),
      KEY idx_category2_display_order (display_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Category2_businesses junction table
    `CREATE TABLE IF NOT EXISTS category2_businesses (
      category2_id INT NOT NULL,
      business_id INT NOT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (category2_id, business_id),
      KEY idx_category2_businesses_category2 (category2_id),
      KEY idx_category2_businesses_business (business_id),
      CONSTRAINT fk_category2_businesses_category2 FOREIGN KEY (category2_id) REFERENCES category2(id) ON DELETE CASCADE,
      CONSTRAINT fk_category2_businesses_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Products table
    `CREATE TABLE IF NOT EXISTS products (
      id INT NOT NULL AUTO_INCREMENT,
      menu_code VARCHAR(255) CHARACTER SET utf8mb4 DEFAULT NULL,
      nama VARCHAR(255) CHARACTER SET utf8mb4 NOT NULL,
      satuan VARCHAR(50) CHARACTER SET utf8mb4 NOT NULL,
      category1_id INT DEFAULT NULL,
      category2_id INT DEFAULT NULL,
      keterangan TEXT CHARACTER SET utf8mb4,
      harga_beli DECIMAL(10,2) DEFAULT NULL,
      ppn DECIMAL(5,2) DEFAULT NULL,
      harga_jual INT DEFAULT NULL,
      harga_khusus DECIMAL(10,2) DEFAULT NULL,
      harga_online DECIMAL(10,2) DEFAULT NULL,
      harga_gofood INT DEFAULT NULL,
      harga_grabfood INT DEFAULT NULL,
      harga_shopeefood INT DEFAULT NULL,
      harga_tiktok INT DEFAULT NULL,
      harga_qpon INT DEFAULT NULL,
      fee_kerja DECIMAL(10,2) DEFAULT NULL,
      image_url VARCHAR(255) CHARACTER SET utf8mb4 DEFAULT NULL,
      status ENUM('active','inactive') CHARACTER SET utf8mb4 DEFAULT 'active',
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      has_customization TINYINT(1) DEFAULT '0',
      is_bundle TINYINT(1) DEFAULT '0',
      PRIMARY KEY (id),
      UNIQUE KEY unique_menu_code_business (menu_code),
      KEY idx_status (status),
      KEY idx_products_harga_beli (harga_beli),
      KEY idx_products_harga_khusus (harga_khusus),
      KEY idx_products_harga_online (harga_online),
      KEY idx_products_category1 (category1_id),
      KEY idx_products_category2 (category2_id),
      CONSTRAINT fk_products_category1 FOREIGN KEY (category1_id) REFERENCES category1(id) ON DELETE SET NULL,
      CONSTRAINT fk_products_category2 FOREIGN KEY (category2_id) REFERENCES category2(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Product_businesses junction table
    `CREATE TABLE IF NOT EXISTS product_businesses (
      product_id INT NOT NULL,
      business_id INT NOT NULL,
      PRIMARY KEY (product_id, business_id),
      KEY business_id (business_id),
      CONSTRAINT product_businesses_ibfk_1 FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      CONSTRAINT product_businesses_ibfk_2 FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

    // Product_customization_types table
    `CREATE TABLE IF NOT EXISTS product_customization_types (
      id INT NOT NULL AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL,
      selection_mode ENUM('single','multiple') NOT NULL,
      display_order INT DEFAULT '0',
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

    // Product_customization_options table
    `CREATE TABLE IF NOT EXISTS product_customization_options (
      id INT NOT NULL AUTO_INCREMENT,
      type_id INT NOT NULL,
      name VARCHAR(100) NOT NULL,
      price_adjustment DECIMAL(10,2) DEFAULT '0.00',
      display_order INT DEFAULT '0',
      status ENUM('active','inactive') DEFAULT 'active',
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY type_id (type_id),
      CONSTRAINT product_customization_options_ibfk_1 FOREIGN KEY (type_id) REFERENCES product_customization_types(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

    // Product_customizations table
    `CREATE TABLE IF NOT EXISTS product_customizations (
      id INT NOT NULL AUTO_INCREMENT,
      product_id INT NOT NULL,
      customization_type_id INT NOT NULL,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY product_id (product_id),
      KEY customization_type_id (customization_type_id),
      CONSTRAINT product_customizations_ibfk_1 FOREIGN KEY (product_id) REFERENCES products(id),
      CONSTRAINT product_customizations_ibfk_2 FOREIGN KEY (customization_type_id) REFERENCES product_customization_types(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

    // Bundle_items table
    `CREATE TABLE IF NOT EXISTS bundle_items (
      id INT NOT NULL AUTO_INCREMENT,
      bundle_product_id INT NOT NULL,
      category2_id INT NOT NULL,
      required_quantity INT NOT NULL DEFAULT '1',
      display_order INT DEFAULT '0',
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_bundle_product (bundle_product_id),
      KEY idx_category2 (category2_id),
      CONSTRAINT fk_bundle_items_category2 FOREIGN KEY (category2_id) REFERENCES category2(id) ON DELETE CASCADE,
      CONSTRAINT fk_bundle_items_product FOREIGN KEY (bundle_product_id) REFERENCES products(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Payment_methods table
    `CREATE TABLE IF NOT EXISTS payment_methods (
      id INT NOT NULL AUTO_INCREMENT,
      name VARCHAR(50) CHARACTER SET utf8mb4 NOT NULL,
      code VARCHAR(20) CHARACTER SET utf8mb4 NOT NULL,
      description TEXT CHARACTER SET utf8mb4,
      is_active TINYINT(1) DEFAULT '1',
      requires_additional_info TINYINT(1) DEFAULT '0',
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY code (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Banks table
    `CREATE TABLE IF NOT EXISTS banks (
      id INT NOT NULL AUTO_INCREMENT,
      bank_code VARCHAR(10) CHARACTER SET utf8mb4 NOT NULL,
      bank_name VARCHAR(100) CHARACTER SET utf8mb4 NOT NULL,
      is_popular TINYINT(1) DEFAULT '0',
      is_active TINYINT(1) DEFAULT '1',
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY bank_code (bank_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Organizations table
    `CREATE TABLE IF NOT EXISTS organizations (
      id INT NOT NULL AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(100) NOT NULL,
      owner_user_id INT NOT NULL,
      subscription_status ENUM('trial','active','inactive','cancelled') DEFAULT 'trial',
      subscription_plan VARCHAR(50) DEFAULT 'basic',
      trial_ends_at DATETIME DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY slug (slug),
      KEY owner_user_id (owner_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3`,

    // Management_groups table
    `CREATE TABLE IF NOT EXISTS management_groups (
      id INT NOT NULL AUTO_INCREMENT,
      name VARCHAR(255) CHARACTER SET utf8mb4 NOT NULL,
      permission_name VARCHAR(255) CHARACTER SET utf8mb4 NOT NULL,
      description MEDIUMTEXT CHARACTER SET utf8mb4,
      organization_id INT NOT NULL,
      manager_user_id INT DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_management_groups_organization (organization_id),
      KEY idx_management_groups_manager (manager_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // CL_accounts table
    `CREATE TABLE IF NOT EXISTS cl_accounts (
      id INT NOT NULL AUTO_INCREMENT,
      account_code VARCHAR(20) CHARACTER SET utf8mb4 NOT NULL,
      account_name VARCHAR(100) CHARACTER SET utf8mb4 NOT NULL,
      contact_info TEXT CHARACTER SET utf8mb4,
      credit_limit DECIMAL(10,2) DEFAULT '0.00',
      current_balance DECIMAL(10,2) DEFAULT '0.00',
      is_active TINYINT(1) DEFAULT '1',
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY account_code (account_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Roles table
    `CREATE TABLE IF NOT EXISTS roles (
      id INT NOT NULL AUTO_INCREMENT,
      name VARCHAR(50) NOT NULL,
      description VARCHAR(255) DEFAULT NULL,
      organization_id INT DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY name (name),
      KEY idx_roles_organization (organization_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3`,

    // Permissions table
    `CREATE TABLE IF NOT EXISTS permissions (
      id INT NOT NULL AUTO_INCREMENT,
      name VARCHAR(50) NOT NULL,
      description VARCHAR(255) DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      category_id INT DEFAULT NULL,
      organization_id INT DEFAULT NULL,
      business_id INT DEFAULT NULL,
      status ENUM('active','inactive') NOT NULL DEFAULT 'active',
      PRIMARY KEY (id),
      UNIQUE KEY name (name),
      KEY category_id (category_id),
      KEY idx_permissions_organization (organization_id),
      KEY idx_permissions_status (status),
      KEY idx_permissions_business (business_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3`,

    // Role_permissions table
    `CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INT NOT NULL,
      permission_id INT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (role_id, permission_id),
      KEY permission_id (permission_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3`,

    // Transactions table
    `CREATE TABLE IF NOT EXISTS transactions (
      id INT NOT NULL AUTO_INCREMENT,
      uuid_id VARCHAR(36) NOT NULL,
      business_id INT NOT NULL,
      user_id INT NOT NULL,
      shift_uuid CHAR(36) DEFAULT NULL,
      payment_method VARCHAR(50) NOT NULL,
      pickup_method ENUM('dine-in','take-away') NOT NULL,
      total_amount DECIMAL(15,2) NOT NULL,
      voucher_discount DECIMAL(15,2) DEFAULT '0.00',
      voucher_type ENUM('none','percent','nominal','free') DEFAULT 'none',
      voucher_value DECIMAL(15,2) DEFAULT NULL,
      voucher_label VARCHAR(255) DEFAULT NULL,
      final_amount DECIMAL(15,2) NOT NULL,
      amount_received DECIMAL(15,2) NOT NULL,
      change_amount DECIMAL(15,2) DEFAULT '0.00',
      status ENUM('pending','completed','cancelled','refunded') DEFAULT 'completed',
      refund_status ENUM('none','partial','full') NOT NULL DEFAULT 'none',
      refund_total DECIMAL(15,2) NOT NULL DEFAULT '0.00',
      last_refunded_at DATETIME DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      contact_id INT DEFAULT NULL,
      customer_name VARCHAR(255) DEFAULT NULL,
      customer_unit INT DEFAULT NULL,
      note TEXT,
      bank_name VARCHAR(100) DEFAULT NULL,
      card_number VARCHAR(20) DEFAULT NULL,
      cl_account_id INT DEFAULT NULL,
      cl_account_name VARCHAR(100) DEFAULT NULL,
      bank_id INT DEFAULT NULL,
      receipt_number INT DEFAULT NULL,
      transaction_type ENUM('drinks','bakery') DEFAULT 'drinks',
      payment_method_id INT NOT NULL,
      sync_status ENUM('pending','synced','failed') DEFAULT 'pending',
      sync_attempts INT DEFAULT 0,
      synced_at DATETIME DEFAULT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uuid_id (uuid_id),
      KEY idx_transactions_business (business_id),
      KEY idx_transactions_user (user_id),
      KEY idx_transactions_date (created_at),
      KEY idx_transactions_status (status),
      KEY idx_transactions_contact (contact_id),
      KEY idx_transactions_cl_account (cl_account_id),
      KEY idx_transactions_bank (bank_name),
      KEY idx_transactions_bank_id (bank_id),
      KEY idx_transactions_note (note(100)),
      KEY idx_transactions_receipt_number (receipt_number),
      KEY idx_transactions_transaction_type (transaction_type),
      KEY idx_transactions_daily_receipt (business_id, created_at, receipt_number),
      KEY idx_transactions_payment_method (payment_method_id),
      KEY idx_transactions_shift_uuid (shift_uuid),
      CONSTRAINT fk_transactions_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      CONSTRAINT fk_transactions_payment_method FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id),
      CONSTRAINT fk_transactions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

    // Transaction_items table
    `CREATE TABLE IF NOT EXISTS transaction_items (
      id INT NOT NULL AUTO_INCREMENT,
      uuid_id VARCHAR(36) NOT NULL,
      transaction_id INT NOT NULL,
      uuid_transaction_id VARCHAR(36) NOT NULL,
      product_id INT NOT NULL,
      quantity INT NOT NULL DEFAULT '1',
      unit_price DECIMAL(15,2) NOT NULL,
      total_price DECIMAL(15,2) NOT NULL,
      custom_note TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      bundle_selections_json JSON DEFAULT NULL,
      production_started_at TIMESTAMP NULL DEFAULT NULL,
      production_status ENUM('preparing','finished') DEFAULT NULL,
      production_finished_at TIMESTAMP NULL DEFAULT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uuid_id (uuid_id),
      KEY idx_transaction_items_transaction (transaction_id),
      KEY idx_transaction_items_product (product_id),
      KEY idx_transaction_items_created (created_at),
      KEY fk_transaction_items_transaction_uuid (uuid_transaction_id),
      KEY idx_transaction_items_production_status (production_status),
      CONSTRAINT fk_transaction_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      CONSTRAINT fk_transaction_items_transaction_uuid FOREIGN KEY (uuid_transaction_id) REFERENCES transactions(uuid_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

    // Transaction_item_customizations table
    `CREATE TABLE IF NOT EXISTS transaction_item_customizations (
      id INT NOT NULL AUTO_INCREMENT,
      transaction_item_id INT NOT NULL,
      uuid_transaction_item_id VARCHAR(255) DEFAULT NULL,
      customization_type_id INT NOT NULL,
      bundle_product_id INT DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_transaction_item (transaction_item_id),
      KEY idx_uuid_transaction_item (uuid_transaction_item_id),
      KEY idx_customization_type (customization_type_id),
      KEY idx_tic_item_type (transaction_item_id, customization_type_id),
      KEY idx_tic_bundle_product (bundle_product_id),
      KEY idx_tic_item_bundle (transaction_item_id, bundle_product_id),
      CONSTRAINT fk_tic_customization_type FOREIGN KEY (customization_type_id) REFERENCES product_customization_types(id) ON DELETE CASCADE,
      CONSTRAINT fk_tic_transaction_item FOREIGN KEY (transaction_item_id) REFERENCES transaction_items(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

    // Transaction_item_customization_options table
    `CREATE TABLE IF NOT EXISTS transaction_item_customization_options (
      id INT NOT NULL AUTO_INCREMENT,
      transaction_item_customization_id INT NOT NULL,
      customization_option_id INT NOT NULL,
      option_name VARCHAR(255) NOT NULL,
      price_adjustment DECIMAL(15,2) NOT NULL DEFAULT '0.00',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_transaction_item_customization (transaction_item_customization_id),
      KEY idx_customization_option (customization_option_id),
      KEY idx_option_name (option_name),
      KEY idx_tico_customization_option (transaction_item_customization_id, customization_option_id),
      CONSTRAINT fk_tico_customization_option FOREIGN KEY (customization_option_id) REFERENCES product_customization_options(id) ON DELETE CASCADE,
      CONSTRAINT fk_tico_transaction_item_customization FOREIGN KEY (transaction_item_customization_id) REFERENCES transaction_item_customizations(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

    // Shifts table
    `CREATE TABLE IF NOT EXISTS shifts (
      id INT NOT NULL AUTO_INCREMENT,
      uuid_id CHAR(36) CHARACTER SET utf8mb4 NOT NULL,
      business_id INT NOT NULL,
      user_id INT NOT NULL,
      user_name VARCHAR(255) CHARACTER SET utf8mb4 NOT NULL,
      shift_start DATETIME NOT NULL,
      shift_end DATETIME DEFAULT NULL,
      modal_awal DECIMAL(15,2) DEFAULT '0.00',
      kas_akhir DECIMAL(15,2) DEFAULT NULL,
      kas_expected DECIMAL(15,2) DEFAULT NULL,
      kas_selisih DECIMAL(15,2) DEFAULT NULL,
      kas_selisih_label ENUM('balanced','plus','minus') CHARACTER SET utf8mb4 NOT NULL DEFAULT 'balanced',
      cash_sales_total DECIMAL(15,2) DEFAULT NULL,
      cash_refund_total DECIMAL(15,2) DEFAULT NULL,
      status VARCHAR(50) CHARACTER SET utf8mb4 DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at BIGINT DEFAULT NULL,
      synced_at BIGINT DEFAULT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY idx_shifts_uuid (uuid_id),
      KEY idx_shifts_business_user (business_id, user_id),
      KEY idx_shifts_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Transaction_refunds table
    `CREATE TABLE IF NOT EXISTS transaction_refunds (
      id INT NOT NULL AUTO_INCREMENT,
      uuid_id VARCHAR(255) NOT NULL,
      transaction_uuid VARCHAR(255) NOT NULL,
      business_id INT NOT NULL,
      shift_uuid CHAR(36) DEFAULT NULL,
      refunded_by INT NOT NULL,
      refund_amount DECIMAL(15,2) NOT NULL,
      cash_delta DECIMAL(15,2) NOT NULL DEFAULT '0.00',
      payment_method_id INT NOT NULL,
      reason VARCHAR(255) DEFAULT NULL,
      note TEXT,
      refund_type ENUM('full','partial') DEFAULT 'full',
      status ENUM('pending','completed','failed') DEFAULT 'completed',
      refunded_at DATETIME NOT NULL,
      synced_at DATETIME DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY fk_transaction_refunds_transaction (transaction_uuid),
      CONSTRAINT fk_transaction_refunds_transaction FOREIGN KEY (transaction_uuid) REFERENCES transactions(uuid_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

    // Printer1_audit_log table
    `CREATE TABLE IF NOT EXISTS printer1_audit_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      transaction_id VARCHAR(32) NOT NULL,
      printer1_receipt_number INT NOT NULL,
      global_counter INT DEFAULT NULL,
      printed_at DATETIME NOT NULL,
      printed_at_epoch BIGINT NOT NULL,
      synced_at DATETIME DEFAULT NULL,
      reprint_count INT DEFAULT '0',
      is_reprint INT DEFAULT '0',
      PRIMARY KEY (id),
      UNIQUE KEY uk_printer1_audit (transaction_id, printer1_receipt_number, printed_at_epoch),
      KEY idx_printer1_printed_at (printed_at_epoch)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

    // Printer2_audit_log table
    `CREATE TABLE IF NOT EXISTS printer2_audit_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      business_id INT DEFAULT NULL,
      printer2_receipt_number INT NOT NULL,
      print_mode ENUM('auto','manual') NOT NULL,
      cycle_number INT DEFAULT NULL,
      printed_by_user_id INT DEFAULT NULL,
      printed_at DATETIME NOT NULL,
      printed_at_epoch BIGINT NOT NULL,
      transaction_id VARCHAR(36) NOT NULL,
      global_counter INT DEFAULT NULL,
      synced_at DATETIME DEFAULT NULL,
      reprint_count INT DEFAULT '0',
      is_reprint INT DEFAULT '0',
      PRIMARY KEY (id),
      UNIQUE KEY uk_printer2_audit (transaction_id, printer2_receipt_number, printed_at_epoch),
      KEY idx_p2_audit_mode (print_mode),
      KEY idx_p2_audit_time (printed_at_epoch),
      KEY fk_p2_audit_user (printed_by_user_id),
      KEY fk_p2_audit_business (business_id),
      CONSTRAINT fk_p2_audit_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL,
      CONSTRAINT fk_p2_audit_tx FOREIGN KEY (transaction_id) REFERENCES transactions(uuid_id) ON DELETE CASCADE,
      CONSTRAINT fk_p2_audit_user FOREIGN KEY (printed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

    // Printer_daily_counters table
    `CREATE TABLE IF NOT EXISTS printer_daily_counters (
      id INT NOT NULL AUTO_INCREMENT,
      printer_type VARCHAR(50) NOT NULL,
      business_id INT NOT NULL,
      date DATE NOT NULL,
      counter INT NOT NULL DEFAULT '0',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY unique_counter (printer_type, business_id, date),
      KEY idx_business (business_id),
      KEY idx_date (date),
      KEY idx_printer (printer_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

    // Printer_mode_settings table
    `CREATE TABLE IF NOT EXISTS printer_mode_settings (
      id INT NOT NULL AUTO_INCREMENT,
      printer_type VARCHAR(50) UNIQUE NOT NULL,
      mode ENUM('auto','manual') NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

    // Printer2_automation table
    `CREATE TABLE IF NOT EXISTS printer2_automation (
      id INT NOT NULL AUTO_INCREMENT,
      business_id INT NOT NULL,
      cycle_number INT NOT NULL,
      selected_transactions TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY unique_business_cycle (business_id, cycle_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

    // UUID_sequence_tracker table
    `CREATE TABLE IF NOT EXISTS uuid_sequence_tracker (
      \`key\` VARCHAR(255) PRIMARY KEY,
      counter INT DEFAULT 0,
      created_at BIGINT,
      updated_at BIGINT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

    // Offline_refunds table (for salespulse database)
    `CREATE TABLE IF NOT EXISTS offline_refunds (
      id INT NOT NULL AUTO_INCREMENT,
      refund_data JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sync_status ENUM('pending','synced','failed') DEFAULT 'pending',
      sync_attempts INT DEFAULT 0,
      last_sync_attempt TIMESTAMP NULL DEFAULT NULL,
      PRIMARY KEY (id),
      KEY idx_offline_refunds_sync_status (sync_status),
      KEY idx_offline_refunds_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Sync_status table
    `CREATE TABLE IF NOT EXISTS sync_status (
      \`key\` VARCHAR(255) PRIMARY KEY,
      last_sync BIGINT,
      status VARCHAR(50),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

    // Printer_configs table (local printer configuration)
    `CREATE TABLE IF NOT EXISTS printer_configs (
      id VARCHAR(255) PRIMARY KEY,
      printer_type VARCHAR(50) NOT NULL,
      system_printer_name VARCHAR(255) NOT NULL,
      extra_settings TEXT DEFAULT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_printer_type (printer_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

    // Restaurant_rooms table (for table layout management)
    `CREATE TABLE IF NOT EXISTS restaurant_rooms (
      id INT NOT NULL AUTO_INCREMENT,
      business_id INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      canvas_width INT NULL DEFAULT NULL COMMENT 'Canvas width in pixels (e.g., 1366). NULL = auto-calculate from container width',
      canvas_height INT NULL DEFAULT NULL COMMENT 'Canvas height in pixels (e.g., 768). NULL = auto-calculate 16:9 aspect ratio',
      font_size_multiplier DECIMAL(3,2) NULL DEFAULT 1.0 COMMENT 'Font size multiplier (e.g., 0.5 = 50% smaller, 1.0 = normal, 1.5 = 50% larger, 2.0 = 2x larger). Default 1.0',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_restaurant_rooms_business_id (business_id),
      CONSTRAINT fk_restaurant_rooms_business_id 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Restaurant_tables table (for table layout management)
    `CREATE TABLE IF NOT EXISTS restaurant_tables (
      id INT NOT NULL AUTO_INCREMENT,
      room_id INT NOT NULL,
      table_number VARCHAR(50) NOT NULL,
      position_x DECIMAL(10, 6) NOT NULL DEFAULT 0.000000 COMMENT 'X coordinate as percentage (0-100)',
      position_y DECIMAL(10, 6) NOT NULL DEFAULT 0.000000 COMMENT 'Y coordinate as percentage (0-100)',
      width DECIMAL(10, 6) NOT NULL DEFAULT 5.000000 COMMENT 'Width as percentage of canvas (0-100)',
      height DECIMAL(10, 6) NOT NULL DEFAULT 5.000000 COMMENT 'Height as percentage of canvas (0-100)',
      capacity INT NOT NULL DEFAULT 4 COMMENT 'Number of seats',
      shape ENUM('circle', 'rectangle') NOT NULL DEFAULT 'circle',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_restaurant_tables_room_id (room_id),
      CONSTRAINT fk_restaurant_tables_room_id 
        FOREIGN KEY (room_id) 
        REFERENCES restaurant_rooms(id) 
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Restaurant_layout_elements table (for custom elements like doors, bathrooms, etc.)
    `CREATE TABLE IF NOT EXISTS restaurant_layout_elements (
      id INT NOT NULL AUTO_INCREMENT,
      room_id INT NOT NULL,
      label VARCHAR(255) NOT NULL COMMENT 'Text label (e.g., "Pintu Keluar", "Kamar Mandi")',
      position_x DECIMAL(10, 6) NOT NULL DEFAULT 0.000000 COMMENT 'X coordinate as percentage (0-100)',
      position_y DECIMAL(10, 6) NOT NULL DEFAULT 0.000000 COMMENT 'Y coordinate as percentage (0-100)',
      width DECIMAL(10, 6) NOT NULL DEFAULT 4.000000 COMMENT 'Width as percentage of canvas (0-100)',
      height DECIMAL(10, 6) NOT NULL DEFAULT 4.000000 COMMENT 'Height as percentage of canvas (0-100)',
      element_type VARCHAR(50) NOT NULL DEFAULT 'custom' COMMENT 'Type of element (door, bathroom, custom, etc.)',
      color VARCHAR(7) NOT NULL DEFAULT '#9CA3AF' COMMENT 'Background color in hex format',
      text_color VARCHAR(7) NOT NULL DEFAULT '#000000' COMMENT 'Text color in hex format',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_restaurant_layout_elements_room_id (room_id),
      CONSTRAINT fk_restaurant_layout_elements_room_id 
        FOREIGN KEY (room_id) 
        REFERENCES restaurant_rooms(id) 
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  ];

  try {
    for (const tableSql of tables) {
      await executeUpdate(tableSql);
    }
    console.log('✅ MySQL schema initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize MySQL schema:', error);
    throw error;
  }
}





