-- Migration: Add production status tracking to transaction_items
-- This migration adds columns to track kitchen/barista production status
-- Run this on SQLite (local) database

-- Add production_status column (TEXT: 'preparing' or 'finished')
ALTER TABLE transaction_items ADD COLUMN production_status TEXT DEFAULT NULL;

-- Add production_started_at timestamp (when item first appears in production display)
ALTER TABLE transaction_items ADD COLUMN production_started_at TEXT DEFAULT NULL;

-- Add production_finished_at timestamp (when item is marked as finished)
ALTER TABLE transaction_items ADD COLUMN production_finished_at TEXT DEFAULT NULL;

-- Optional: Create index for faster queries on production status
CREATE INDEX IF NOT EXISTS idx_transaction_items_production_status ON transaction_items(production_status);
