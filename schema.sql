-- Buds Relay D1 Database Schema
-- Version: 1.0.0
-- Last Updated: December 22, 2025

-- Devices table: Track all registered devices for E2EE
CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY NOT NULL,
    owner_did TEXT NOT NULL,
    owner_phone_hash TEXT NOT NULL,
    device_name TEXT NOT NULL,
    pubkey_x25519 TEXT NOT NULL,
    pubkey_ed25519 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    registered_at INTEGER NOT NULL,
    last_seen_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_devices_owner_did ON devices(owner_did);
CREATE INDEX IF NOT EXISTS idx_devices_phone_hash ON devices(owner_phone_hash);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);

-- Encrypted messages table: E2EE message queue
CREATE TABLE IF NOT EXISTS encrypted_messages (
    message_id TEXT PRIMARY KEY NOT NULL,
    receipt_cid TEXT NOT NULL,
    sender_did TEXT NOT NULL,
    sender_device_id TEXT NOT NULL,
    recipient_dids TEXT NOT NULL,       -- JSON array of DIDs
    encrypted_payload TEXT NOT NULL,     -- Base64 encrypted CBOR
    wrapped_keys TEXT NOT NULL,          -- JSON map: {deviceId: wrappedKey}
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_recipient ON encrypted_messages(recipient_dids);
CREATE INDEX IF NOT EXISTS idx_messages_expires ON encrypted_messages(expires_at);
CREATE INDEX IF NOT EXISTS idx_messages_receipt_cid ON encrypted_messages(receipt_cid);

-- Phone to DID mapping: Privacy-preserving lookup (SHA-256 hashed)
CREATE TABLE IF NOT EXISTS phone_to_did (
    phone_hash TEXT PRIMARY KEY NOT NULL,
    did TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Message delivery tracking: Inbox polling state
CREATE TABLE IF NOT EXISTS message_delivery (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    recipient_did TEXT NOT NULL,
    delivered_at INTEGER,
    FOREIGN KEY (message_id) REFERENCES encrypted_messages(message_id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_recipient ON message_delivery(recipient_did);
CREATE INDEX IF NOT EXISTS idx_delivery_status ON message_delivery(delivered_at);
