-- Track which user (by email) created each reservation.
ALTER TABLE reservations
  ADD COLUMN created_by_email VARCHAR(255) DEFAULT NULL COMMENT 'Email of user who created the reservation'
  AFTER penanggung_jawab_id;
