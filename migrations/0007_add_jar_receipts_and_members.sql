-- Migration 0007: Add jar_receipts and jar_members tables (Relay Envelope Architecture)
-- Phase 10.3 Module 0.6: Relay Infrastructure
--
-- CRITICAL ARCHITECTURE (Dec 30, 2025):
-- - Relay envelope: Separates signed payload from relay metadata
-- - Sequence number is NOT in signed bytes (in envelope only)
-- - jar_members is materialized view (updated from receipts, not manual sync)
--
-- Purpose: Relay becomes authoritative source of truth for:
-- 1. Sequence number assignment (atomic, conflict-free, in envelope)
-- 2. Jar membership state (materialized view from receipts)
-- 3. Receipt storage (backfill source)

-- Jar membership state (materialized view from receipts)
-- Updated automatically when relay processes jar receipts
CREATE TABLE IF NOT EXISTS jar_members (
    jar_id TEXT NOT NULL,
    member_did TEXT NOT NULL,
    status TEXT NOT NULL,          -- 'active' | 'pending' | 'removed'
    role TEXT NOT NULL,             -- 'owner' | 'member'
    added_at INTEGER NOT NULL,      -- From receipt timestamp (ms)
    removed_at INTEGER,             -- From receipt timestamp (ms), NULL if active
    added_by_receipt_cid TEXT,      -- Which receipt added this member
    removed_by_receipt_cid TEXT,    -- Which receipt removed this member
    PRIMARY KEY (jar_id, member_did)
);

-- Index for looking up all jars a member belongs to
CREATE INDEX IF NOT EXISTS idx_jar_members_did
ON jar_members(member_did);

-- Index for looking up active members of a jar (for access control)
CREATE INDEX IF NOT EXISTS idx_jar_members_jar_status
ON jar_members(jar_id, status);

-- Jar receipts (relay envelope - separates signed payload from relay metadata)
CREATE TABLE IF NOT EXISTS jar_receipts (
    -- Relay envelope (NOT part of signed bytes)
    jar_id TEXT NOT NULL,
    sequence_number INTEGER NOT NULL,   -- AUTHORITATIVE (relay-assigned, UNIQUE)
    receipt_cid TEXT NOT NULL,          -- CID of signed payload
    receipt_data BLOB NOT NULL,         -- Signed payload bytes (canonical CBOR)
    signature BLOB NOT NULL,            -- Client's Ed25519 signature over receipt_data
    sender_did TEXT NOT NULL,           -- Duplicated from payload for indexing
    received_at INTEGER NOT NULL,       -- Server timestamp (ms)
    parent_cid TEXT,                    -- Optional causal metadata (extracted from payload)

    PRIMARY KEY (jar_id, sequence_number)
);

-- CRITICAL: Ensure receipt_cid is globally unique (prevent duplicate receipts)
CREATE UNIQUE INDEX IF NOT EXISTS idx_jar_receipts_cid
ON jar_receipts(receipt_cid);

-- Index for backfill queries (jar + sequence range)
CREATE INDEX IF NOT EXISTS idx_jar_receipts_jar_seq
ON jar_receipts(jar_id, sequence_number);

-- Index for sender lookups (debugging, analytics)
CREATE INDEX IF NOT EXISTS idx_jar_receipts_sender
ON jar_receipts(sender_did);

-- Index for parent_cid lookups (dependency resolution)
CREATE INDEX IF NOT EXISTS idx_jar_receipts_parent
ON jar_receipts(parent_cid);
