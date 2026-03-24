-- Migration: Add expires_at column for retention
-- This is a one-time migration for existing databases

-- Add expires_at column if it doesn't exist
ALTER TABLE emails ADD COLUMN expires_at DATETIME;

-- Populate expires_at for existing rows (7 days from now)
UPDATE emails SET expires_at = datetime('now', '+7 days') WHERE expires_at IS NULL;

-- Add preview column if it doesn't exist
ALTER TABLE emails ADD COLUMN preview TEXT;

-- Create index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_emails_expires_at ON emails(expires_at);