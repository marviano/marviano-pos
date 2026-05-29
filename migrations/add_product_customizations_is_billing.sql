-- Per-product customization link: billing vs optional add-on group on POS.

ALTER TABLE product_customizations
  ADD COLUMN is_billing TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '1 = billing/package group; 0 = optional add-on'
    AFTER customization_type_id;
