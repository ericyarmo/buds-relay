-- Migration 0005: Add account_salts table for phone-based DID derivation
-- Phase 10.3 Module 0.2: Phone-Based Identity
--
-- Purpose: Store per-account salts for DID derivation
-- DID = did:phone:SHA256(phone + account_salt)
--
-- Security:
-- - phone_hash: SHA-256(phone) - prevents rainbow table on salts table
-- - salt: Random 32-byte value (base64) - prevents DID → phone reversal
-- - All devices with same phone get same salt → same DID

CREATE TABLE IF NOT EXISTS account_salts (
    phone_hash TEXT PRIMARY KEY NOT NULL,  -- SHA-256 of E.164 phone number
    salt TEXT NOT NULL,                     -- Random 32-byte salt (base64)
    created_at INTEGER NOT NULL             -- Unix timestamp (ms)
);

-- Index for lookups (phone_hash is already PK, so indexed)
-- Index for potential cleanup/auditing by creation time
CREATE INDEX IF NOT EXISTS idx_account_salts_created_at
ON account_salts(created_at);
