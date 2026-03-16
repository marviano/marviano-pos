-- If reservations was created with status ENUM('upcoming','done','cancelled'),
-- align to spec: use 'attended' instead of 'done'.
-- Run this only if the table already exists with the old enum.

-- Update existing rows first (safe if column already uses 'attended')
UPDATE reservations SET status = 'attended' WHERE status = 'done';

-- Modify enum to spec: upcoming, attended, cancelled
ALTER TABLE reservations
  MODIFY COLUMN status ENUM('upcoming','attended','cancelled') NOT NULL DEFAULT 'upcoming';
