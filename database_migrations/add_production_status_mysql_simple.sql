-- Migration: Add production status tracking to transaction_items (MySQL Server)
-- Simple version for SQLyog
-- Run this script - if columns already exist, you'll get errors but that's OK
-- This migration adds columns to track kitchen/barista production status

-- Step 1: Add production_status column (ENUM: 'preparing' or 'finished')
ALTER TABLE transaction_items 
ADD COLUMN production_status ENUM('preparing', 'finished') DEFAULT NULL 
COMMENT 'Production status: preparing = being prepared, finished = ready';

-- Step 2: Add production_started_at timestamp
ALTER TABLE transaction_items 
ADD COLUMN production_started_at TIMESTAMP NULL DEFAULT NULL 
COMMENT 'Timestamp when production started (item appeared in kitchen/barista display)';

-- Step 3: Add production_finished_at timestamp
ALTER TABLE transaction_items 
ADD COLUMN production_finished_at TIMESTAMP NULL DEFAULT NULL 
COMMENT 'Timestamp when production finished (item marked as ready)';

-- Step 4: Create index for faster queries
CREATE INDEX idx_transaction_items_production_status ON transaction_items(production_status);
