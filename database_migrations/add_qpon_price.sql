ALTER TABLE products
  ADD COLUMN harga_qpon INT DEFAULT NULL COMMENT 'Price for Qpon platform' AFTER harga_tiktok;
