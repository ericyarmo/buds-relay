-- Migration 0004: Add R2 storage for encrypted message payloads
-- Scale Analysis Fix: Move 500KB encrypted payloads from D1 to R2 object storage
-- Impact: Prevents D1 database bloat (50GB/day → 10GB limit exceeded in hours)

-- Add r2_key column to store R2 object key instead of inline encrypted_payload
-- Strategy: Gradual migration
--   - New messages: Store payload in R2, set r2_key
--   - Old messages: Keep encrypted_payload for backward compatibility
--   - Inbox API: Return presigned URL if r2_key exists, else encrypted_payload
ALTER TABLE encrypted_messages ADD COLUMN r2_key TEXT;

-- Index for efficient R2 key lookups
CREATE INDEX IF NOT EXISTS idx_encrypted_messages_r2_key
ON encrypted_messages(r2_key)
WHERE r2_key IS NOT NULL;

-- Note: encrypted_payload column remains for backward compatibility
-- Future migration: After all messages migrated to R2, can drop encrypted_payload column
