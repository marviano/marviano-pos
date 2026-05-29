-- Room rental analytics: structured duration on each rental transaction line.
-- Apply to local POS MySQL (salespulse schema) and Salespulse server DB.

ALTER TABLE transaction_items
  ADD COLUMN rental_duration_value DECIMAL(10,2) NULL
    COMMENT 'Structured rental/borrow duration amount (paired with rental_duration_unit)'
    AFTER custom_note,
  ADD COLUMN rental_duration_unit ENUM('hour','day','month') NULL
    COMMENT 'Unit for rental_duration_value; NULL when line is not a room rental'
    AFTER rental_duration_value;

ALTER TABLE transaction_items
  ADD INDEX idx_transaction_items_rental_duration (rental_duration_unit, rental_duration_value);
