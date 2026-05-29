-- Sewa Ruangan: per-product open pricing + package option duration metadata.
-- See salespulse/migrations/add_rental_product_settings.sql

ALTER TABLE products
  ADD COLUMN rental_allow_open_price TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '1 = POS may use harga bebas; 0 = customization packages only'
    AFTER has_customization;

ALTER TABLE product_customization_options
  ADD COLUMN rental_duration_value DECIMAL(10,2) NULL
    AFTER price_adjustment,
  ADD COLUMN rental_duration_unit ENUM('hour','day','month') NULL
    AFTER rental_duration_value;
