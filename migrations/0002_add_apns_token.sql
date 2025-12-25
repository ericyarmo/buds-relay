-- Migration: Add APNs token support for push notifications
-- Version: 0002
-- Created: December 24, 2025

-- Add apns_token column to devices table
ALTER TABLE devices ADD COLUMN apns_token TEXT;

-- Index for push notification queries
CREATE INDEX idx_devices_apns_token ON devices(apns_token) WHERE apns_token IS NOT NULL;
