-- Restaurant Table Layout — Section Feature
-- Run once; ignore errors if objects already exist.

-- 1. Create restaurant_sections table (sections within a room, e.g. Front, VIP Area)
CREATE TABLE IF NOT EXISTS restaurant_sections (
  id INT NOT NULL AUTO_INCREMENT,
  room_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#E5E7EB',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_restaurant_sections_room_id (room_id),
  CONSTRAINT fk_restaurant_sections_room_id
    FOREIGN KEY (room_id)
    REFERENCES restaurant_rooms(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Add section_id to restaurant_tables (optional; NULL = unassigned)
ALTER TABLE restaurant_tables
ADD COLUMN section_id INT NULL DEFAULT NULL COMMENT 'Optional section within the room' AFTER shape;

-- 3. Index and FK (ignore if already exist)
ALTER TABLE restaurant_tables ADD INDEX idx_restaurant_tables_section_id (section_id);
ALTER TABLE restaurant_tables
ADD CONSTRAINT fk_restaurant_tables_section_id
  FOREIGN KEY (section_id) REFERENCES restaurant_sections(id) ON DELETE SET NULL;
