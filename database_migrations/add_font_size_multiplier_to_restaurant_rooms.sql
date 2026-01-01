-- Migration: Add font_size_multiplier to restaurant_rooms table
-- Purpose: Allow users to control global font size for all tables and layout elements in a room
-- Date: 2024

-- Add font_size_multiplier column to restaurant_rooms table
ALTER TABLE restaurant_rooms
ADD COLUMN font_size_multiplier DECIMAL(3,2) NULL DEFAULT 1.0 COMMENT 'Font size multiplier (e.g., 0.5 = 50% smaller, 1.0 = normal, 1.5 = 50% larger, 2.0 = 2x larger). Default 1.0';

-- Update existing rooms to use 1.0 (no change) by default
-- This maintains backward compatibility with existing layouts
UPDATE restaurant_rooms SET font_size_multiplier = 1.0 WHERE font_size_multiplier IS NULL;
