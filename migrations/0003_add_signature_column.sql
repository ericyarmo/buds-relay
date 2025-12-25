-- Migration 0003: Add signature column to encrypted_messages table
-- Phase 7 Hardening: Include Ed25519 signature for receipt verification

-- Add signature column to encrypted_messages table
ALTER TABLE encrypted_messages ADD COLUMN signature TEXT NOT NULL DEFAULT '';

-- Update default constraint after adding column (SQLite doesn't support modifying defaults directly)
-- Note: New rows should always include signature, empty default is for backwards compatibility only
