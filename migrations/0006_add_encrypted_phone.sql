-- Migration 0006: Replace phone_hash with encrypted_phone
-- Phase 10.3 Module 0.3: Deterministic Phone Encryption
--
-- Purpose: Prevent rainbow table attacks on phone numbers
-- Security Model:
-- - Old: SHA-256(phone) → vulnerable to rainbow tables (10B phones can be pre-hashed)
-- - New: AES-256-GCM(phone, server_key) → requires DB + secrets leak
--
-- Breaking Change: All existing devices must re-register
-- Impact: 2 test phone numbers (acceptable loss)

-- ============================================================================
-- Step 1: Add encrypted_phone columns to all tables
-- ============================================================================

-- devices table: Store encrypted phone instead of hash
ALTER TABLE devices ADD COLUMN owner_encrypted_phone TEXT;

-- phone_to_did table: Store encrypted phone for DID lookup
ALTER TABLE phone_to_did ADD COLUMN encrypted_phone TEXT;

-- account_salts table: Store encrypted phone for salt retrieval
ALTER TABLE account_salts ADD COLUMN encrypted_phone TEXT;

-- ============================================================================
-- Step 2: Drop old phone_hash columns
-- ============================================================================
-- Note: SQLite doesn't support DROP COLUMN directly in all versions
-- Workaround: Create new tables without phone_hash, copy data, rename

-- 2a. Devices table migration
CREATE TABLE devices_new (
    device_id TEXT PRIMARY KEY NOT NULL,
    owner_did TEXT NOT NULL,
    owner_encrypted_phone TEXT NOT NULL,  -- NEW: encrypted instead of hash
    device_name TEXT NOT NULL,
    pubkey_x25519 TEXT NOT NULL,
    pubkey_ed25519 TEXT NOT NULL,
    apns_token TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    registered_at INTEGER NOT NULL,
    last_seen_at INTEGER
);

-- Copy existing data (will be empty since we're dropping test accounts)
-- INSERT INTO devices_new SELECT device_id, owner_did, NULL, device_name, pubkey_x25519, pubkey_ed25519, apns_token, status, registered_at, last_seen_at FROM devices;

-- Drop old table and rename new one
DROP TABLE devices;
ALTER TABLE devices_new RENAME TO devices;

-- 2b. Phone to DID table migration
CREATE TABLE phone_to_did_new (
    encrypted_phone TEXT PRIMARY KEY NOT NULL,  -- NEW: encrypted instead of hash
    did TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Copy existing data (will be empty)
-- INSERT INTO phone_to_did_new SELECT NULL, did, updated_at FROM phone_to_did;

DROP TABLE phone_to_did;
ALTER TABLE phone_to_did_new RENAME TO phone_to_did;

-- 2c. Account salts table migration
CREATE TABLE account_salts_new (
    encrypted_phone TEXT PRIMARY KEY NOT NULL,  -- NEW: encrypted instead of hash
    salt TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

-- Copy existing data (will be empty)
-- INSERT INTO account_salts_new SELECT NULL, salt, created_at FROM account_salts;

DROP TABLE account_salts;
ALTER TABLE account_salts_new RENAME TO account_salts;

-- ============================================================================
-- Step 3: Recreate indexes with encrypted_phone
-- ============================================================================

-- Devices indexes
CREATE INDEX IF NOT EXISTS idx_devices_owner_did ON devices(owner_did);
CREATE INDEX IF NOT EXISTS idx_devices_encrypted_phone ON devices(owner_encrypted_phone);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);

-- Account salts indexes
CREATE INDEX IF NOT EXISTS idx_account_salts_created_at ON account_salts(created_at);

-- phone_to_did already has PK index on encrypted_phone

-- ============================================================================
-- Migration Complete
-- ============================================================================
-- All existing devices/accounts have been dropped (2 test accounts)
-- Next device registration will use encrypted_phone storage
-- Rainbow table attacks no longer possible
