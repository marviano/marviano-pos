CREATE TABLE IF NOT EXISTS `transaction_item_customizations` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `transaction_item_id` INT NOT NULL,
  `uuid_transaction_item_id` VARCHAR(255) DEFAULT NULL,
  `customization_type_id` INT NOT NULL,
  `bundle_product_id` INT DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_transaction_item` (`transaction_item_id`),
  KEY `idx_uuid_transaction_item` (`uuid_transaction_item_id`),
  KEY `idx_customization_type` (`customization_type_id`),
  KEY `idx_bundle_product` (`bundle_product_id`),
  CONSTRAINT `fk_tic_transaction_item` FOREIGN KEY (`transaction_item_id`) REFERENCES `transaction_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tic_customization_type` FOREIGN KEY (`customization_type_id`) REFERENCES `product_customization_types` (`id`) ON DELETE CASCADE
)
ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `transaction_item_customization_options` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `transaction_item_customization_id` INT NOT NULL,
  `customization_option_id` INT NOT NULL,
  `option_name` VARCHAR(255) NOT NULL,
  `price_adjustment` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_transaction_item_customization` (`transaction_item_customization_id`),
  KEY `idx_customization_option` (`customization_option_id`),
  CONSTRAINT `fk_tico_transaction_item_customization` FOREIGN KEY (`transaction_item_customization_id`) REFERENCES `transaction_item_customizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tico_customization_option` FOREIGN KEY (`customization_option_id`) REFERENCES `product_customization_options` (`id`) ON DELETE CASCADE
)
ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci;
















