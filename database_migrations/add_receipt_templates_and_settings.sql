-- Migration: Add receipt templates and settings tables
-- This allows dynamic receipt template and content management

-- Receipt templates table (stores HTML template code)
CREATE TABLE IF NOT EXISTS receipt_templates (
  id INT NOT NULL AUTO_INCREMENT,
  template_type ENUM('receipt', 'bill') NOT NULL COMMENT 'Type of template: receipt (paid transaction) or bill (unpaid order)',
  business_id INT DEFAULT NULL COMMENT 'NULL = global template, INT = business-specific template',
  template_code LONGTEXT NOT NULL COMMENT 'HTML template code with placeholders',
  is_active TINYINT(1) DEFAULT 1 COMMENT 'Whether this template is active',
  version INT DEFAULT 1 COMMENT 'Template version number',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY unique_template_type_business (template_type, business_id),
  KEY idx_receipt_templates_type (template_type),
  KEY idx_receipt_templates_business (business_id),
  KEY idx_receipt_templates_active (is_active),
  CONSTRAINT fk_receipt_templates_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Receipt settings table (stores logo, address, phone, etc.)
CREATE TABLE IF NOT EXISTS receipt_settings (
  id INT NOT NULL AUTO_INCREMENT,
  business_id INT DEFAULT NULL COMMENT 'NULL = global settings, INT = business-specific settings',
  store_name VARCHAR(255) DEFAULT NULL COMMENT 'Store name (e.g., "MOMOYO")',
  branch_name VARCHAR(255) DEFAULT NULL COMMENT 'Branch name',
  address TEXT DEFAULT NULL COMMENT 'Store address',
  phone_number VARCHAR(50) DEFAULT NULL COMMENT 'Contact phone number',
  contact_phone VARCHAR(50) DEFAULT NULL COMMENT 'Alternative contact phone (e.g., "silahkan hubungi: 0813-9888-8568")',
  logo_base64 LONGTEXT DEFAULT NULL COMMENT 'Logo as base64 data URI',
  footer_text TEXT DEFAULT NULL COMMENT 'Footer text on receipt',
  partnership_contact VARCHAR(255) DEFAULT NULL COMMENT 'Partnership contact info',
  is_active TINYINT(1) DEFAULT 1 COMMENT 'Whether these settings are active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY unique_receipt_settings_business (business_id),
  KEY idx_receipt_settings_business (business_id),
  KEY idx_receipt_settings_active (is_active),
  CONSTRAINT fk_receipt_settings_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
