-- Pre-ordered items snapshot on reservation (CartItem shape)
ALTER TABLE reservations
  ADD COLUMN items_json JSON DEFAULT NULL
    COMMENT 'Pre-ordered items: [{product_id, product_name, quantity, unit_price, customizations?, customNote?, bundleSelections?, packageSelections?}]';
