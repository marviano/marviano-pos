-- Migration: Add canvas_width and canvas_height to restaurant_rooms table
-- Purpose: Allow users to configure custom canvas dimensions for each room
-- Date: 2024

-- Add canvas dimension columns to restaurant_rooms table
ALTER TABLE restaurant_rooms
ADD COLUMN canvas_width INT NULL DEFAULT NULL COMMENT 'Canvas width in pixels (e.g., 1366). NULL = auto-calculate from container width',
ADD COLUMN canvas_height INT NULL DEFAULT NULL COMMENT 'Canvas height in pixels (e.g., 768). NULL = auto-calculate 16:9 aspect ratio';

-- Update existing rooms to use NULL (auto-calculate) by default
-- This maintains backward compatibility with existing layouts
UPDATE restaurant_rooms SET canvas_width = NULL, canvas_height = NULL WHERE canvas_width IS NULL;

